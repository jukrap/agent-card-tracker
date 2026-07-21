export const PRODUCT_NAME = 'Codex Renown';
export const PRODUCT_TAGLINE = 'Your Codex usage, told through milestones.';
export const PRODUCT_DISCLAIMER = 'Codex Renown is an unofficial community project. It is not affiliated with or endorsed by OpenAI.';
export const TARGET_REPOSITORY = 'jukrap/codex-renown';
export const CLI_NAME = 'codex-renown';
export const CLI_ALIASES = Object.freeze(['agent-card']);

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/u;

export function repositoryOwner(repository) {
  if (typeof repository !== 'string') {
    throw new TypeError('repository must be an owner/name string');
  }
  const parts = repository.split('/');
  if (parts.length !== 2
    || !OWNER_PATTERN.test(parts[0])
    || !REPOSITORY_PATTERN.test(parts[1])) {
    throw new TypeError('repository must be a validated owner/name string');
  }
  return parts[0];
}

export const PUBLIC_HANDLE = `@${repositoryOwner(TARGET_REPOSITORY)}`;
