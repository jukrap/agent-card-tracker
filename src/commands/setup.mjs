import * as defaultFileSystem from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  LOCAL_CONFIG_FILENAME,
  LocalConfigError,
  createLocalConfig,
  validateLocalConfig,
} from '../config.mjs';
import { stableStringify } from '../lib/atomic-file.mjs';

const HELP = `Usage: agent-card setup [--timezone IANA_TIMEZONE]

Create an ignored, private local configuration for this device.
Copying this configuration to another computer is unsupported.
`;

function write(stream, value) {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

function commandError(code) {
  return new LocalConfigError(code);
}

async function pathExists(filePath, fileSystem) {
  try {
    await fileSystem.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw commandError('CONFIG_READ_FAILED');
  }
}

function resolvedTimezone(timezone) {
  if (timezone !== undefined) {
    return timezone;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export async function setupLocalConfig({
  configPath = path.join(process.cwd(), LOCAL_CONFIG_FILENAME),
  timezone,
  randomBytesImpl,
  fileSystem = defaultFileSystem,
} = {}) {
  if (await pathExists(configPath, fileSystem)) {
    throw commandError('CONFIG_EXISTS');
  }

  const config = createLocalConfig({
    timezone: resolvedTimezone(timezone),
    randomBytesImpl,
  });

  try {
    await fileSystem.mkdir(path.dirname(configPath), { recursive: true });
    await fileSystem.writeFile(configPath, stableStringify(config), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw commandError('CONFIG_EXISTS');
    }
    throw commandError('CONFIG_WRITE_FAILED');
  }
  return config;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--timezone' && args[index + 1]) {
      options.timezone = args[index + 1];
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      options.invalid = true;
    }
  }
  return options;
}

export async function run(
  args,
  io,
  {
    cwd = process.cwd(),
    fileSystem = defaultFileSystem,
    randomBytesImpl,
  } = {},
) {
  const options = parseArgs(args);
  if (options.help) {
    write(io.stdout, HELP);
    return 0;
  }
  if (options.invalid) {
    write(io.stderr, 'Setup failed: INVALID_ARGUMENT');
    return 2;
  }

  try {
    const config = await setupLocalConfig({
      configPath: path.join(cwd, LOCAL_CONFIG_FILENAME),
      timezone: options.timezone,
      fileSystem,
      randomBytesImpl,
    });
    write(io.stdout, `created ${config.deviceId}`);
    return 0;
  } catch (error) {
    const code = error instanceof LocalConfigError ? error.code : 'SETUP_FAILED';
    write(io.stderr, `Setup failed: ${code}`);
    return 1;
  }
}
