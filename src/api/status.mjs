import log from 'log';
import { StatusCodes } from '@dyesoft/alea-core';
import { APIRouteDefinition } from './common.mjs';

const logger = log.get('api:status');

/* API route definition for status-related endpoints. */
class StatusAPI extends APIRouteDefinition {
    /* Create a new Status API using the given database connection and package version. */
    constructor(db, packageVersion) {
        super(db);
        this.packageVersion = packageVersion;
        this.get('/health', this.handleGetHealth.bind(this));
        this.get('/version', this.handleGetVersion.bind(this));
    }

    /* Handler for GET /status/health. Attempts to ping the database to determine app health. */
    async handleGetHealth(req, res, error) {
        try {
            await this.db.command({ping: 1});
        } catch (e) {
            logger.error(`Failed to ping database: ${e}`);
            error('Health check failed', StatusCodes.SERVICE_UNAVAILABLE);
            return;
        }
        res.status(StatusCodes.NO_CONTENT).end();
    }

    /* Handler for GET /status/version. Returns the current package version in JSON format. */
    async handleGetVersion(req, res, error) {
        res.json({version: this.packageVersion});
    }
}

export default StatusAPI;
