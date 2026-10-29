import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';

export const isNativeApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export interface NativeDocument { id: string; name: string; size: number }
export type StudyPanelSide = 'left' | 'right';
export type StudyAIProvider = 'chatgpt' | 'gemini' | 'claude';
export const studyAIProviders: { id: StudyAIProvider; label: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT' }, { id: 'gemini', label: 'Gemini' }, { id: 'claude', label: 'Claude' },
];
export function studyAIProvider(value: unknown): StudyAIProvider {
  return studyAIProviders.find(provider => provider.id === value)?.id || 'chatgpt';
}
export function studyAILabel(provider: StudyAIProvider) {
  return studyAIProviders.find(item => item.id === provider)!.label;
}
interface NotelinDevicePlugin {
  beginExport(options: { name: string; mimeType: string }): Promise<{ id: string }>;
  appendExport(options: { id: string; index: number; data: string }): Promise<void>;
  finishExport(options: { id: string }): Promise<{ saved: boolean; uri?: string }>;
  cancelExport(options: { id: string }): Promise<void>;
  pendingDocuments(): Promise<{ documents: NativeDocument[] }>;
  readDocument(options: { id: string; offset: number; length: number }): Promise<{ data: string }>;
  completeDocument(options: { id: string }): Promise<void>;
  setAppearance(options: { dark: boolean }): Promise<void>;
  openUpdates(): Promise<void>;
  openStudyBrowser(options: { noteId: string; url?: string }): Promise<void>;
  openStudyAI(options: { noteId: string; provider: StudyAIProvider }): Promise<void>;
  closeStudyPanel(): Promise<void>;
  setStudyPanelOccluded(options: { hidden: boolean }): Promise<void>;
  getStudyPanelSettings(): Promise<{ side: StudyPanelSide }>;
  setStudyPanelSide(options: { side: StudyPanelSide }): Promise<void>;
  clearStudyLoginCookies(): Promise<void>;
  addListener(event: 'documentReceived' | 'stylusButtonPressed', callback: () => void): Promise<PluginListenerHandle>;
}
const device = registerPlugin<NotelinDevicePlugin>('NotelinDevice');
const chunkSize = 512 * 1024;

export async function initializeNativeShell() {
  if (!isNativeApp) return;
  await App.addListener('backButton', () => {
    const event = new Event('notelin-native-back', { cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) history.back();
  });
  await App.addListener('pause', () => window.dispatchEvent(new Event('notelin-pause')));
  await device.addListener('stylusButtonPressed', () => window.dispatchEvent(new Event('notelin-native-stylus-button')));
  const appearance = () => { void device.setAppearance({ dark: document.documentElement.dataset.theme === 'dark' }).catch(console.error); };
  new MutationObserver(appearance).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  appearance();
  const settings = await device.getStudyPanelSettings();
  document.documentElement.dataset.studyPanelSide = settings.side === 'left' ? 'left' : 'right';
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Keep each bridge message bounded: a large PDF must not become one enormous
// JavaScript/Java base64 string. Android's document picker chooses the destination.
export async function saveNativeDocument(blob: Blob, name: string) {
  const { id } = await device.beginExport({ name, mimeType: blob.type || 'application/octet-stream' });
  try {
    for (let offset = 0, index = 0; offset < blob.size; offset += chunkSize, index++) {
      await device.appendExport({ id, index, data: await base64(blob.slice(offset, offset + chunkSize)) });
    }
    return (await device.finishExport({ id })).saved;
  } finally { await device.cancelExport({ id }).catch(() => {}); }
}

export function pendingNativeDocuments() { return device.pendingDocuments(); }
export function completeNativeDocument(id: string) { return device.completeDocument({ id }); }
export function onNativeDocument(callback: () => void) { return device.addListener('documentReceived', callback); }
export function openNativeUpdates() { return device.openUpdates(); }
export function openNativeStudyBrowser(noteId: string, url?: string) { return device.openStudyBrowser({ noteId, ...(url ? { url } : {}) }); }
export function openNativeStudyAI(noteId: string, provider: StudyAIProvider) { return device.openStudyAI({ noteId, provider }); }
export function closeNativeStudyPanel() { return device.closeStudyPanel(); }
export function setNativeStudyPanelOccluded(hidden: boolean) { return device.setStudyPanelOccluded({ hidden }); }
export function getStudyPanelSide(): StudyPanelSide { return document.documentElement.dataset.studyPanelSide === 'left' ? 'left' : 'right'; }
export async function setStudyPanelSide(side: StudyPanelSide) {
  await device.setStudyPanelSide({ side });
  document.documentElement.dataset.studyPanelSide = side;
}
export function clearStudyLoginCookies() { return device.clearStudyLoginCookies(); }
export async function readNativeDocument(document: NativeDocument): Promise<File> {
  if (!Number.isSafeInteger(document.size) || document.size < 0 || document.size > 150 * 1024 * 1024) throw new Error('PDF는 150MB 이하로 가져올 수 있어요.');
  const parts: ArrayBuffer[] = [];
  for (let offset = 0; offset < document.size; offset += chunkSize) {
    const { data } = await device.readDocument({ id: document.id, offset, length: Math.min(chunkSize, document.size - offset) });
    const decoded = atob(data), bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    if (decoded.length !== Math.min(chunkSize, document.size - offset)) throw new Error('PDF 파일을 읽지 못했어요. 다시 열어 주세요.');
    parts.push(bytes.buffer);
  }
  return new File(parts, document.name, { type: 'application/pdf' });
}
