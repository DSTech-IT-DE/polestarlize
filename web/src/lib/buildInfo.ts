declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __REPOSITORY_URL__: string;

export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __APP_COMMIT__;
export const REPOSITORY_URL = __REPOSITORY_URL__;
/** `owner/repo` part of the repository URL. */
export const REPOSITORY_NAME = REPOSITORY_URL.replace(/^https?:\/\/github\.com\//, '');
