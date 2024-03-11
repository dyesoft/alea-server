/*
 * Run a test server on localhost.
 * This is intended to serve as a demo of how the resources provided by this package may be used.
 */

import log from 'log';
import logNode from 'log-node';
import config from './example-config.json' assert { type: 'json' };
import { MongoDB } from './database/index.mjs';
import { Mailer } from './mail.mjs';
import Server from './server.mjs';

logNode();

const version = '0.1.0';
config.packageVersion = version;

const logger = log.get('main');

const db = new MongoDB(config);
await db.init();

const mailer = new Mailer(config);
await mailer.init();

const server = new Server(config, db, mailer);
server.run();

logger.info(`API server running on port ${config.server.port}...`)
