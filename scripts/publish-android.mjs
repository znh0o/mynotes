import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = 'znh0o/mynotes';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const name = `Notelin-${version}.apk`;
const bytes = await readFile(new URL(`../artifacts/${name}`, import.meta.url));
const checksum = `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`;
await writeFile(new URL(`../artifacts/${name}.sha256`, import.meta.url), checksum);

// Use the same repository credentials as git push. Never write the token to a
// file or print credential-helper output, headers, or response request objects.
let token = process.env.GH_TOKEN;
if (!token) {
  const credentials = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  });
  if (credentials.status !== 0) throw new Error('Repository credentials are unavailable. Set GH_TOKEN.');
  token = credentials.stdout.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
}
if (!token) throw new Error('Repository credentials are unavailable.');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 404 && method === 'GET') return undefined;
  if (!response.ok) throw new Error(`GitHub release request failed (${response.status}).`);
  return response.json();
}
const tag = `v${version}`;
let release = await api(`/releases/tags/${tag}`);
if (!release) {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  release = await api('/releases', 'POST', {
    tag_name: tag, target_commitish: revision, name: `Notelin ${version} — Android`, draft: true, prerelease: false,
    body: 'Android 설치형 Notelin입니다.\n\n- 필기 화면에 타이머를 추가했습니다. 이름과 시간을 지정해 저장하고 다른 노트에서 다시 사용할 수 있습니다.\n- 시작, 일시정지, 계속, 초기화를 지원하며 노트를 바꾸거나 앱을 다시 열어도 실행 시간은 유지됩니다.\n- 기존 노트, PDF, 필기와 웹 패널 로그인 정보는 유지합니다.\n\n타이머 완료 알림은 Notelin이 열려 있을 때 표시됩니다. Android가 앱을 완전히 종료한 상태의 시스템 알림은 지원하지 않습니다.\n\n첫 설치와 업데이트의 마지막 확인은 Android 시스템에서 진행합니다.',
  });
}
for (const [assetName, content, type] of [[name, bytes, 'application/vnd.android.package-archive'], [`${name}.sha256`, Buffer.from(checksum), 'text/plain'], ['Notelin.apk', bytes, 'application/vnd.android.package-archive']]) {
  const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
  const existing = release.assets.find(asset => asset.name === assetName);
  if (existing) {
    if (existing.digest !== digest) throw new Error('A different file already exists for this release. Increase the app version.');
    continue;
  }
  const response = await fetch(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(assetName)}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': type }, body: content,
  });
  if (!response.ok) throw new Error(`APK upload failed (${response.status}). The draft has not been published.`);
}
if (release.draft) release = await api(`/releases/${release.id}`, 'PATCH', { draft: false, make_latest: 'true' });
console.log(`Release: ${release.html_url}`);
console.log(`APK: https://github.com/${repo}/releases/download/${tag}/${name}`);
