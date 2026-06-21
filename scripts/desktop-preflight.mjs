import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const checks = [
  {
    name: 'Node.js',
    ok: Boolean(process.version),
    value: process.version
  },
  {
    name: 'npm',
    ok: Boolean(readNpmVersion()),
    value: readNpmVersion()
  },
  {
    name: 'Rust compiler',
    ok: commandExists('rustc'),
    hint: 'Install Rust with rustup before running npm run desktop:dev or npm run desktop:build.'
  },
  {
    name: 'Cargo',
    ok: commandExists('cargo'),
    hint: 'Cargo is installed with Rust. Restart the terminal after installing rustup.'
  },
  {
    name: 'Tauri CLI',
    ok: Boolean(readPackageVersion('@tauri-apps/cli')),
    value: readPackageVersion('@tauri-apps/cli')
  }
];

let hasFailure = false;

for (const check of checks) {
  if (check.ok) {
    console.log(`ok   ${check.name}${check.value ? `: ${check.value}` : ''}`);
    continue;
  }

  hasFailure = true;
  console.log(`miss ${check.name}: ${check.hint ?? 'Required for desktop packaging.'}`);
}

if (hasFailure) {
  console.log('\nDesktop packaging is not ready yet. The web app can still run with npm run dev.');
  process.exitCode = 1;
} else {
  console.log('\nDesktop packaging prerequisites look ready.');
}

function readNpmVersion() {
  const userAgent = process.env.npm_config_user_agent;
  const match = userAgent?.match(/npm\/([^\s]+)/);
  return match?.[1] ?? null;
}

function readPackageVersion(packageName) {
  try {
    const packageJsonPath = join('node_modules', ...packageName.split('/'), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return typeof packageJson.version === 'string' ? packageJson.version : null;
  } catch {
    return null;
  }
}

function commandExists(command) {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const paths = (process.env.PATH ?? '').split(delimiter).filter(Boolean);

  return paths.some((folder) =>
    extensions.some((extension) => existsSync(join(folder, `${command}${extension}`)))
  );
}
