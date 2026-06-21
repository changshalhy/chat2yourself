import 'dotenv/config';
import express from 'express';

type ChatRole = 'user' | 'assistant';

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type DeepSeekMessage = {
  role: 'system' | ChatRole;
  content: string;
};

type ReportSection = {
  id: string;
  title: string;
  body?: string;
  items?: string[];
};

type SessionReport = {
  title: string;
  sections: ReportSection[];
};

type InterviewStageId =
  | 'arrival'
  | 'facts'
  | 'perspective'
  | 'pattern'
  | 'tiny_step'
  | 'closing';

const app = express();
const port = Number(process.env.PORT ?? 8787);

const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '');
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

const interviewSystemPrompt = `
你是一个本地自我访谈工具里的 AI 访谈伙伴。
你的目标是帮助用户把混乱想法说清一点，而不是诊断、裁判或替用户做决定。

风格要求：
- 温暖、好奇、轻微幽默，但不油腻。
- 每次回复只抓一个最值得继续看的点，主要追问一个问题。
- 先复述你听见的重点，再给一个很小的整理角度。
- 不使用临床诊断标签，不给人生重大决定下结论。
- 如果用户表达自伤、伤人、无法保证安全或正在遭受即时危险，停止普通访谈，建议立刻联系身边可信任的人、当地紧急服务或危机热线。

回复语言跟随用户。
`.trim();

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    model,
    hasApiKey: Boolean(process.env.DEEPSEEK_API_KEY)
  });
});

app.post('/api/chat', async (request, response) => {
  const messages = normalizeMessages(request.body?.messages);
  const stage = normalizeStage(request.body?.stage);

  if (messages.length === 0) {
    response.status(400).json({ error: '请先写下一点想法，再开始这次访谈。' });
    return;
  }

  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');

  if (latestUserMessage && needsImmediateSupport(latestUserMessage.content)) {
    response.json({
      message: {
        role: 'assistant',
        content:
          '我先不继续普通访谈了。你刚才说的内容听起来可能涉及伤害自己、伤害别人，或现在很难保证安全。请立刻联系身边可信任的人，让对方陪你；如果有即时危险，请马上拨打当地紧急服务电话。你不需要一个人扛过这一段。'
      }
    });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    response.status(500).json({
      error: 'Missing DEEPSEEK_API_KEY. Create a local .env from .env.example and restart the server.'
    });
    return;
  }

  try {
    const deepSeekResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt(stage) },
          ...messages
        ] satisfies DeepSeekMessage[],
        temperature: 0.75,
        max_tokens: 900
      })
    });

    const payload = await deepSeekResponse.json().catch(() => null);

    if (!deepSeekResponse.ok) {
      response.status(deepSeekResponse.status).json({
        error: extractProviderError(payload) ?? 'DeepSeek request failed.'
      });
      return;
    }

    const content = payload?.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
      response.status(502).json({ error: 'DeepSeek returned an empty response.' });
      return;
    }

    response.json({ message: { role: 'assistant', content: content.trim() } });
  } catch (error) {
    console.error(error);
    response.status(502).json({
      error: '暂时连不上模型服务。可以检查网络、API key，或者稍后再试。'
    });
  }
});

app.post('/api/report', async (request, response) => {
  const messages = normalizeMessages(request.body?.messages);
  const stage = normalizeStage(request.body?.stage);

  if (messages.length === 0) {
    response.status(400).json({ error: '至少需要一点对话内容，才能生成阶段性自我画像。' });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    response.status(500).json({
      error: 'Missing DEEPSEEK_API_KEY. Create a local .env from .env.example and restart the server.'
    });
    return;
  }

  try {
    const deepSeekResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildReportPrompt(stage) },
          {
            role: 'user',
            content: messages
              .map((message) => `${message.role === 'user' ? '用户' : '访谈伙伴'}：${message.content}`)
              .join('\n\n')
          }
        ] satisfies DeepSeekMessage[],
        temperature: 0.35,
        max_tokens: 1600
      })
    });

    const payload = await deepSeekResponse.json().catch(() => null);

    if (!deepSeekResponse.ok) {
      response.status(deepSeekResponse.status).json({
        error: extractProviderError(payload) ?? 'DeepSeek report request failed.'
      });
      return;
    }

    const content = payload?.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
      response.status(502).json({ error: 'DeepSeek returned an empty report.' });
      return;
    }

    const report = parseReport(content);
    response.json({ report });
  } catch (error) {
    console.error(error);
    response.status(502).json({
      error: '暂时生成不了报告。可以检查网络、API key，或者稍后再试。'
    });
  }
});

function buildSystemPrompt(stage: InterviewStageId): string {
  return `${interviewSystemPrompt}

当前访谈阶段：${stageGuidance[stage].name}
阶段意图：${stageGuidance[stage].intent}
阶段回应方式：${stageGuidance[stage].style}
如果用户的内容明显更适合停留在上一阶段，可以温和地停留，不要机械推进。`;
}

function buildReportPrompt(stage: InterviewStageId): string {
  return `
你是一个温暖、克制的自我访谈整理员。请基于用户与访谈伙伴的对话，生成一份《阶段性自我画像》。

当前访谈阶段：${stageGuidance[stage].name}

要求：
- 只根据对话内容生成，不编造经历、关系、事件或结论。
- 不做心理诊断，不给重大人生决定下结论。
- 语气温暖、具体、像认真听过这次谈话。
- 栏目根据内容动态出现，不要为了凑数硬写。
- 默认可考虑这些栏目：今天的主题、我听见的重点、情绪天气、反复出现的句子、可能的模式、仍然悬着的问题、可选小动作、给未来自己的便签。
- 只有用户明确谈到亲密关系、伴侣、喜欢、爱、分手、暧昧、婚姻等内容时，才可以生成关系专题；否则不要出现关系专题。
- 每个栏目尽量短，避免空泛鸡汤。

只返回严格 JSON，不要 markdown，不要代码块。格式：
{
  "title": "一句简短标题",
  "sections": [
    {
      "id": "short_snake_case_id",
      "title": "栏目标题",
      "body": "一小段文字，可选",
      "items": ["短句，可选"]
    }
  ]
}
`.trim();
}

app.listen(port, '127.0.0.1', () => {
  console.log(`Chat2Yourself API listening on http://127.0.0.1:${port}`);
});

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((message): ChatMessage | null => {
      if (!message || typeof message !== 'object') {
        return null;
      }

      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;

      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
        return null;
      }

      const trimmed = content.trim();
      return trimmed.length > 0 ? { role, content: trimmed } : null;
    })
    .filter((message): message is ChatMessage => message !== null)
    .slice(-20);
}

function parseReport(content: string): SessionReport {
  const parsed = JSON.parse(extractJsonObject(content)) as unknown;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Report payload is not an object.');
  }

  const candidate = parsed as { title?: unknown; sections?: unknown };
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections.map(normalizeReportSection).filter((section): section is ReportSection => section !== null)
    : [];

  if (sections.length === 0) {
    throw new Error('Report payload has no sections.');
  }

  return {
    title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : '阶段性自我画像',
    sections
  };
}

function normalizeReportSection(value: unknown): ReportSection | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { id?: unknown; title?: unknown; body?: unknown; items?: unknown };
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';

  if (!title) {
    return null;
  }

  const items = Array.isArray(candidate.items)
    ? candidate.items.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : undefined;
  const body = typeof candidate.body === 'string' && candidate.body.trim() ? candidate.body.trim() : undefined;

  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : title,
    title,
    ...(body ? { body } : {}),
    ...(items && items.length > 0 ? { items } : {})
  };
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1]?.trim() ?? trimmed;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in report response.');
  }

  return source.slice(start, end + 1);
}

const stageGuidance: Record<InterviewStageId, { name: string; intent: string; style: string }> = {
  arrival: {
    name: '入场校准',
    intent: '帮助用户先落地，确认此刻最想谈的一团东西，不急着分析。',
    style: '先接住情绪和语气，再问一个很小的入口问题。'
  },
  facts: {
    name: '事实铺开',
    intent: '把事情、人物、时间、触发点和反复出现的场景铺开。',
    style: '少解释，多帮用户把具体事实说出来。'
  },
  perspective: {
    name: '视角切换',
    intent: '邀请用户从另一个角度看同一件事，比如旁观者、未来自己或身体感受。',
    style: '轻轻提出一个视角实验，不强迫用户接受。'
  },
  pattern: {
    name: '模式命名',
    intent: '给反复出现的句子、动作、担心或关系姿势起一个暂时的名字。',
    style: '用“也许像是”而不是定论，保留开放性。'
  },
  tiny_step: {
    name: '下一步轻触',
    intent: '从谈话中浮出一个很小、低压力、可选择的下一步。',
    style: '只给一个小动作或一个观察点，不制造打卡压力。'
  },
  closing: {
    name: '收束保存',
    intent: '把这次谈话轻轻收束，帮用户带走一句重点或一个悬着的问题。',
    style: '简短总结，不开新坑，给未来自己留一句温和便签。'
  }
};

function normalizeStage(value: unknown): InterviewStageId {
  const stageIds: InterviewStageId[] = ['arrival', 'facts', 'perspective', 'pattern', 'tiny_step', 'closing'];
  return typeof value === 'string' && stageIds.includes(value as InterviewStageId)
    ? (value as InterviewStageId)
    : 'arrival';
}

function extractProviderError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const error = (payload as { error?: unknown }).error;

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }

  return null;
}

function needsImmediateSupport(content: string): boolean {
  const normalized = content.toLocaleLowerCase();
  const riskPatterns = [
    '自杀',
    '轻生',
    '不想活',
    '活不下去',
    '结束生命',
    '伤害自己',
    '伤害别人',
    '杀了',
    'kill myself',
    'suicide',
    'end my life',
    'hurt myself',
    'hurt someone'
  ];

  return riskPatterns.some((pattern) => normalized.includes(pattern));
}
