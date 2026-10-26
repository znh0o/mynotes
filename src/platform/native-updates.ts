import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeUpdate { available: boolean; version: string; installedVersion: string }
interface NativeUpdater {
  check(): Promise<NativeUpdate>;
  install(): Promise<{ needsPermission: boolean }>;
  addListener(event: 'downloadProgress', callback: (progress: { percent: number }) => void): Promise<PluginListenerHandle>;
}
const updater = registerPlugin<NativeUpdater>('NotelinUpdater');
export const checkNativeUpdate = () => updater.check();
export const installNativeUpdate = () => updater.install();
export const onNativeUpdateProgress = (callback: (progress: { percent: number }) => void) => updater.addListener('downloadProgress', callback);
