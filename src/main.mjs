/*
 * Run a test server on localhost.
 * This is intended to serve as a demo of how the resources provided by this package may be used.
 */

import log from 'log';
import logNode from 'log-node';
import config from './example-config.json' assert { type: 'json' };
import Server from './server.mjs';

logNode();

const logger = log.get('main');

const version = '0.1.0';
config.packageVersion = version;

const server = new Server(config);
await server.init();
server.run();

logger.info(`API server running on port ${config.server.port}...`)

process.on('SIGINT', () => {
    logger.info('Received interrupt signal; shutting down API server...');
    server.stop().then(() => logger.info('Server shut down successfully.'));
});
