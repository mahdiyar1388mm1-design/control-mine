'use strict';

const config = require('./config');
const { migrate } = require('./db/migrate');
const { close } = require('./db');
const { createApp } = require('./app');
const { startRewardScheduler } = require('./modules/lth/scheduler');
const logger = require('./utils/logger');

migrate((msg) => logger.info(msg));

const rewardScheduler = startRewardScheduler({ intervalMs: 30000 });
const app = createApp();
const server = app.listen(config.port, config.host, () => {
  logger.info(`CENTRAL MINE API listening on http://${config.host}:${config.port} (${config.env})`);
});

function shutdown(signal) {
  logger.info(`received ${signal}, shutting down gracefully`);
  rewardScheduler.stop();
  server.close(() => {
    close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
