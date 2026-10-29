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
    body: 'Android 설치형 Notelin입니다.\n\n- 기기 브라우저 메뉴에 “이 노트에 주소 저장” 추가\n- 저장한 인터넷 주소와 ChatGPT 대화 주소를 각각 노트별로 기억하고 다음 실행 때 복원\n- 앱 내 패널의 페이지 기록과 연결 브라우저에서 직접 저장한 주소를 별도로 보관\n- 설정에서 앱 내 패널/기기 브라우저 연결 및 왼쪽/오른쪽 위치 선택\n- 앱 내 로그인 쿠키 삭제 기능 유지: 노트와 PDF 데이터는 유지\n\n연결 브라우저는 메뉴에서 직접 저장한 주소를 기억합니다. 방문 페이지의 자동 추적은 하지 않으며, 로그인과 쿠키는 해당 브라우저에서 관리합니다. 브라우저가 Custom Tabs 메뉴를 지원해야 주소 저장 버튼이 표시됩니다.\n\n첫 설치와 업데이트의 마지막 확인은 Android 시스템에서 진행합니다.',
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
