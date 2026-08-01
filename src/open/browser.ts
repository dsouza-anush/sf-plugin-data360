import open, { apps } from 'open';

export type BrowserLauncher = (url: string, privateMode: boolean) => Promise<unknown>;

let launcher: BrowserLauncher = (url, privateMode) =>
  open(url, privateMode ? { app: { name: apps.browserPrivate } } : undefined);

export const launchBrowser = (url: string, privateMode: boolean): Promise<unknown> => launcher(url, privateMode);

export const setBrowserLauncher = (value: BrowserLauncher): void => {
  launcher = value;
};
