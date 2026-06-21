use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
const DEFAULT_MODEL: &str = "deepseek-v4-pro";

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ModelConfig {
    #[serde(rename = "apiKey")]
    api_key: String,
    #[serde(rename = "baseUrl")]
    base_url: String,
    model: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

struct AppState {
    config: Mutex<Option<ModelConfig>>,
}

#[derive(Debug, Serialize)]
struct RuntimeInfo {
    mode: String,
    #[serde(rename = "baseUrl")]
    base_url: String,
    model: String,
    #[serde(rename = "hasApiKey")]
    has_api_key: bool,
    #[serde(rename = "configPath")]
    config_path: String,
}

#[derive(Debug, Deserialize)]
struct SaveModelConfigInput {
    #[serde(rename = "apiKey")]
    api_key: String,
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
    model: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct ChatMessage {
    role: ChatRole,
    content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ChatRole {
    User,
    Assistant,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum InterviewStageId {
    Arrival,
    Facts,
    Perspective,
    Pattern,
    TinyStep,
    Closing,
}

#[derive(Debug, Deserialize)]
struct ChatInput {
    stage: InterviewStageId,
    messages: Vec<ChatMessage>,
}

#[derive(Debug, Serialize)]
struct ChatOutput {
    message: AssistantMessage,
}

#[derive(Debug, Serialize)]
struct AssistantMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReportSection {
    id: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    items: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionReport {
    title: String,
    sections: Vec<ReportSection>,
}

#[derive(Debug, Serialize)]
struct ReportOutput {
    report: SessionReport,
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let config = load_config(app.handle()).ok().flatten();
            app.manage(AppState {
                config: Mutex::new(config),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_info,
            health,
            save_model_config,
            clear_model_config,
            chat,
            generate_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chat2Yourself");
}

#[tauri::command]
fn get_runtime_info(app: AppHandle, state: State<'_, AppState>) -> Result<RuntimeInfo, String> {
    runtime_info(&app, &state)
}

#[tauri::command]
fn health(app: AppHandle, state: State<'_, AppState>) -> Result<RuntimeInfo, String> {
    runtime_info(&app, &state)
}

#[tauri::command]
async fn save_model_config(
    input: SaveModelConfigInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RuntimeInfo, String> {
    let api_key = input.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("请先填写 API Key。".to_string());
    }

    let config = ModelConfig {
        api_key,
        base_url: normalize_base_url(input.base_url.as_deref()),
        model: normalize_model(input.model.as_deref()),
        updated_at: now_stamp(),
    };

    test_model_config(&config).await?;
    write_config(&app, &config)?;
    {
        let mut guard = state
            .config
            .lock()
            .map_err(|_| "无法更新本机模型配置。".to_string())?;
        *guard = Some(config);
    }

    runtime_info(&app, &state)
}

#[tauri::command]
fn clear_model_config(app: AppHandle, state: State<'_, AppState>) -> Result<RuntimeInfo, String> {
    let path = config_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("无法删除本机模型配置：{error}"))?;
    }

    {
        let mut guard = state
            .config
            .lock()
            .map_err(|_| "无法清除本机模型配置。".to_string())?;
        *guard = None;
    }

    runtime_info(&app, &state)
}

#[tauri::command]
async fn chat(input: ChatInput, state: State<'_, AppState>) -> Result<ChatOutput, String> {
    let messages = normalize_messages(input.messages);
    if messages.is_empty() {
        return Err("请先写下一点想法，再开始这次访谈。".to_string());
    }

    if let Some(latest) = messages.iter().rev().find(|message| matches!(message.role, ChatRole::User)) {
        if needs_immediate_support(&latest.content) {
            return Ok(ChatOutput {
                message: AssistantMessage {
                    role: "assistant".to_string(),
                    content: "我先不继续普通访谈了。你刚才说的内容听起来可能涉及伤害自己、伤害别人，或现在很难保证安全。请立刻联系身边可信任的人，让对方陪你；如果有即时危险，请马上拨打当地紧急服务电话。你不需要一个人扛过这一段。".to_string(),
                },
            });
        }
    }

    let config = read_state_config(&state)?;
    let content = request_chat(
        &config,
        vec![json!({
            "role": "system",
            "content": build_system_prompt(input.stage)
        })],
        messages_to_json(messages),
        0.75,
        900,
    )
    .await?;

    Ok(ChatOutput {
        message: AssistantMessage {
            role: "assistant".to_string(),
            content,
        },
    })
}

#[tauri::command]
async fn generate_report(input: ChatInput, state: State<'_, AppState>) -> Result<ReportOutput, String> {
    let messages = normalize_messages(input.messages);
    if messages.is_empty() {
        return Err("至少需要一点对话内容，才能生成阶段性自我画像。".to_string());
    }

    let transcript = messages
        .iter()
        .map(|message| {
            let speaker = match message.role {
                ChatRole::User => "用户",
                ChatRole::Assistant => "访谈伙伴",
            };
            format!("{speaker}：{}", message.content)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let config = read_state_config(&state)?;
    let content = request_chat(
        &config,
        vec![json!({
            "role": "system",
            "content": build_report_prompt(input.stage)
        })],
        vec![json!({
            "role": "user",
            "content": transcript
        })],
        0.35,
        1600,
    )
    .await?;

    Ok(ReportOutput {
        report: parse_report(&content)?,
    })
}

fn runtime_info(app: &AppHandle, state: &State<'_, AppState>) -> Result<RuntimeInfo, String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "无法读取本机模型配置。".to_string())?
        .clone();
    let path = config_path(app)?;

    Ok(RuntimeInfo {
        mode: "desktop".to_string(),
        base_url: config
            .as_ref()
            .map(|value| value.base_url.clone())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string()),
        model: config
            .as_ref()
            .map(|value| value.model.clone())
            .unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        has_api_key: config
            .as_ref()
            .map(|value| !value.api_key.trim().is_empty())
            .unwrap_or(false),
        config_path: path.to_string_lossy().to_string(),
    })
}

fn read_state_config(state: &State<'_, AppState>) -> Result<ModelConfig, String> {
    state
        .config
        .lock()
        .map_err(|_| "无法读取本机模型配置。".to_string())?
        .clone()
        .filter(|config| !config.api_key.trim().is_empty())
        .ok_or_else(|| "未配置 API Key。请先保存本机模型配置。".to_string())
}

fn load_config(app: &AppHandle) -> Result<Option<ModelConfig>, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path).map_err(|error| format!("无法读取本机模型配置：{error}"))?;
    let mut config: ModelConfig =
        serde_json::from_str(&raw).map_err(|_| "本机模型配置文件格式不正确。".to_string())?;
    config.base_url = normalize_base_url(Some(&config.base_url));
    config.model = normalize_model(Some(&config.model));
    Ok(Some(config))
}

fn write_config(app: &AppHandle, config: &ModelConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录：{error}"))?;
    }
    let raw = serde_json::to_string_pretty(config).map_err(|error| format!("无法序列化配置：{error}"))?;
    fs::write(path, raw).map_err(|error| format!("无法写入本机模型配置：{error}"))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(windows) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return Ok(PathBuf::from(appdata).join("Chat2Yourself").join("config.json"));
        }
    }

    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法定位应用配置目录：{error}"))?;
    Ok(dir.join("config.json"))
}

fn normalize_base_url(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or(DEFAULT_BASE_URL).trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_BASE_URL.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_model(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or(DEFAULT_MODEL).trim();
    if trimmed.is_empty() {
        DEFAULT_MODEL.to_string()
    } else {
        trimmed.to_string()
    }
}

fn now_stamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{seconds}")
}

async fn test_model_config(config: &ModelConfig) -> Result<(), String> {
    let content = request_chat(
        config,
        vec![json!({
            "role": "system",
            "content": "Reply with OK."
        })],
        vec![json!({
            "role": "user",
            "content": "OK?"
        })],
        0.0,
        8,
    )
    .await?;

    if content.trim().is_empty() {
        return Err("模型服务返回了空内容。".to_string());
    }

    Ok(())
}

async fn request_chat(
    config: &ModelConfig,
    prefix_messages: Vec<Value>,
    messages: Vec<Value>,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let mut request_messages = prefix_messages;
    request_messages.extend(messages);

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/chat/completions", config.base_url))
        .bearer_auth(config.api_key.trim())
        .json(&json!({
            "model": config.model,
            "messages": request_messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }))
        .send()
        .await
        .map_err(|_| "网络不可达或模型服务暂时无法连接。".to_string())?;

    let status = response.status();
    let payload: Value = response.json().await.unwrap_or_else(|_| json!({}));

    if !status.is_success() {
        return Err(provider_error(status.as_u16(), &payload));
    }

    payload
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "模型服务返回了空内容。".to_string())
}

fn provider_error(status: u16, payload: &Value) -> String {
    let message = extract_provider_message(payload).unwrap_or_else(|| "模型服务请求失败。".to_string());
    let normalized = message.to_lowercase();

    if status == 401 || status == 403 || normalized.contains("api key") || normalized.contains("unauthorized") {
        return "API Key 无效、缺失或权限不足。请检查本地配置。".to_string();
    }

    if status == 404 || normalized.contains("model") || normalized.contains("not found") {
        return "模型不存在或当前账号不可用。请检查模型名。".to_string();
    }

    if status == 429 {
        return "模型服务请求过于频繁或额度不足，请稍后再试。".to_string();
    }

    message
}

fn extract_provider_message(payload: &Value) -> Option<String> {
    match payload.get("error") {
        Some(Value::String(value)) => Some(value.clone()),
        Some(Value::Object(error)) => error
            .get("message")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        _ => None,
    }
}

fn normalize_messages(messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
    messages
        .into_iter()
        .filter_map(|message| {
            let content = message.content.trim().to_string();
            if content.is_empty() {
                None
            } else {
                Some(ChatMessage {
                    role: message.role,
                    content,
                })
            }
        })
        .rev()
        .take(20)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn messages_to_json(messages: Vec<ChatMessage>) -> Vec<Value> {
    messages
        .into_iter()
        .map(|message| {
            let role = match message.role {
                ChatRole::User => "user",
                ChatRole::Assistant => "assistant",
            };
            json!({
                "role": role,
                "content": message.content
            })
        })
        .collect()
}

fn parse_report(content: &str) -> Result<SessionReport, String> {
    let source = extract_json_object(content)?;
    let mut report: SessionReport =
        serde_json::from_str(&source).map_err(|_| "报告 JSON 格式解析失败，可以稍后重试。".to_string())?;

    report.title = report.title.trim().to_string();
    if report.title.is_empty() {
        report.title = "阶段性自我画像".to_string();
    }

    report.sections = report
        .sections
        .into_iter()
        .filter_map(normalize_report_section)
        .collect();

    if report.sections.is_empty() {
        return Err("报告 JSON 格式解析失败，可以稍后重试。".to_string());
    }

    Ok(report)
}

fn normalize_report_section(mut section: ReportSection) -> Option<ReportSection> {
    section.title = section.title.trim().to_string();
    if section.title.is_empty() {
        return None;
    }

    section.id = if section.id.trim().is_empty() {
        section.title.clone()
    } else {
        section.id.trim().to_string()
    };
    section.body = section
        .body
        .map(|body| body.trim().to_string())
        .filter(|body| !body.is_empty());
    section.items = section.items.map(|items| {
        items
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>()
    });
    if section.items.as_ref().is_some_and(Vec::is_empty) {
        section.items = None;
    }

    Some(section)
}

fn extract_json_object(content: &str) -> Result<String, String> {
    let trimmed = content.trim();
    let source = if let Some(start) = trimmed.find("```") {
        let after_fence = &trimmed[start + 3..];
        let after_label = after_fence
            .strip_prefix("json")
            .unwrap_or(after_fence)
            .trim_start();
        if let Some(end) = after_label.find("```") {
            after_label[..end].trim()
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    let start = source
        .find('{')
        .ok_or_else(|| "报告 JSON 格式解析失败，可以稍后重试。".to_string())?;
    let end = source
        .rfind('}')
        .filter(|end| *end > start)
        .ok_or_else(|| "报告 JSON 格式解析失败，可以稍后重试。".to_string())?;
    Ok(source[start..=end].to_string())
}

fn build_system_prompt(stage: InterviewStageId) -> String {
    let guidance = stage_guidance(stage);
    format!(
        "{}\n\n当前访谈阶段：{}\n阶段意图：{}\n阶段回应方式：{}\n如果用户的内容明显更适合停留在上一阶段，可以温和地停留，不要机械推进。",
        INTERVIEW_SYSTEM_PROMPT, guidance.name, guidance.intent, guidance.style
    )
}

fn build_report_prompt(stage: InterviewStageId) -> String {
    let guidance = stage_guidance(stage);
    format!(
        r#"你是一个温暖、克制的自我访谈整理员。请基于用户与访谈伙伴的对话，生成一份《阶段性自我画像》。

当前访谈阶段：{}

要求：
- 只根据对话内容生成，不编造经历、关系、事件或结论。
- 不做心理诊断，不给重大人生决定下结论。
- 语气温暖、具体、像认真听过这次谈话。
- 栏目根据内容动态出现，不要为了凑数硬写。
- 默认可考虑这些栏目：今天的主题、我听见的重点、情绪天气、反复出现的句子、可能的模式、仍然悬着的问题、可选小动作、给未来自己的便签。
- 只有用户明确谈到亲密关系、伴侣、喜欢、爱、分手、暧昧、婚姻等内容时，才可以生成关系专题；否则不要出现关系专题。
- 每个栏目尽量短，避免空泛鸡汤。

只返回严格 JSON，不要 markdown，不要代码块。格式：
{{
  "title": "一句简短标题",
  "sections": [
    {{
      "id": "short_snake_case_id",
      "title": "栏目标题",
      "body": "一小段文字，可选",
      "items": ["短句，可选"]
    }}
  ]
}}"#,
        guidance.name
    )
}

struct StageGuidance {
    name: &'static str,
    intent: &'static str,
    style: &'static str,
}

fn stage_guidance(stage: InterviewStageId) -> StageGuidance {
    match stage {
        InterviewStageId::Arrival => StageGuidance {
            name: "入场校准",
            intent: "帮助用户先落地，确认此刻最想谈的一团东西，不急着分析。",
            style: "先接住情绪和语气，再问一个很小的入口问题。",
        },
        InterviewStageId::Facts => StageGuidance {
            name: "事实铺开",
            intent: "把事情、人物、时间、触发点和反复出现的场景铺开。",
            style: "少解释，多帮用户把具体事实说出来。",
        },
        InterviewStageId::Perspective => StageGuidance {
            name: "视角切换",
            intent: "邀请用户从另一个角度看同一件事，比如旁观者、未来自己或身体感受。",
            style: "轻轻提出一个视角实验，不强迫用户接受。",
        },
        InterviewStageId::Pattern => StageGuidance {
            name: "模式命名",
            intent: "给反复出现的句子、动作、担心或关系姿势起一个暂时的名字。",
            style: "用“也许像是”而不是定论，保留开放性。",
        },
        InterviewStageId::TinyStep => StageGuidance {
            name: "下一步轻触",
            intent: "从谈话中浮出一个很小、低压力、可选择的下一步。",
            style: "只给一个小动作或一个观察点，不制造打卡压力。",
        },
        InterviewStageId::Closing => StageGuidance {
            name: "收束保存",
            intent: "把这次谈话轻轻收束，帮用户带走一句重点或一个悬着的问题。",
            style: "简短总结，不开新坑，给未来自己留一句温和便签。",
        },
    }
}

const INTERVIEW_SYSTEM_PROMPT: &str = r#"你是一个本地自我访谈工具里的 AI 访谈伙伴。
你的目标是帮助用户把混乱想法说清一点，而不是诊断、裁判或替用户做决定。

风格要求：
- 温暖、好奇、轻微幽默，但不油腻。
- 每次回复只抓一个最值得继续看的点，主要追问一个问题。
- 先复述你听见的重点，再给一个很小的整理角度。
- 不使用临床诊断标签，不给人生重大决定下结论。
- 如果用户表达自伤、伤人、无法保证安全或正在遭受即时危险，停止普通访谈，建议立刻联系身边可信任的人、当地紧急服务或危机热线。

回复语言跟随用户。"#;

fn needs_immediate_support(content: &str) -> bool {
    let normalized = content.to_lowercase();
    [
        "自杀",
        "轻生",
        "不想活",
        "活不下去",
        "结束生命",
        "伤害自己",
        "伤害别人",
        "杀了",
        "kill myself",
        "suicide",
        "end my life",
        "hurt myself",
        "hurt someone",
    ]
    .iter()
    .any(|pattern| normalized.contains(pattern))
}
