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
    body: 'Android 설치형 Notelin입니다.\n\n- 인터넷 패널의 별표 메뉴에서 즐겨찾기 저장·열기·삭제\n- 로그인 쿠키와 웹 저장소를 보존하고 패널 종료·앱 백그라운드 전환 때 저장\n- 필기 화면에 별도 AI 버튼 추가: 같은 패널에서 chatgpt.com 열기\n- 로그인에 사용하는 새 창을 패널 안에서 유지하도록 개선\n\n사이트의 로그인 정책과 세션 만료는 해당 서비스에서 결정합니다. 첫 설치와 업데이트의 마지막 확인은 Android 시스템에서 진행합니다.',
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
