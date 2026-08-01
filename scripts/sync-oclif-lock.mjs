#!/usr/bin/env node

import { copyFile } from 'node:fs/promises';

await copyFile(new URL('../yarn.lock', import.meta.url), new URL('../oclif.lock', import.meta.url));
