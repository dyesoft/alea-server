import bodyParser from 'body-parser';
import express from 'express';
import request from 'supertest';
import { apiErrorHandler } from './common.mjs';

export function app(api, prefix = '/') {
    const app = express();
    app.use(bodyParser.json());
    app.use(prefix, api.getRouter());
    app.use(apiErrorHandler);
    return request(app);
}
