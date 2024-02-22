import bodyParser from 'body-parser';
import express from 'express';
import request from 'supertest';

export function app(api, prefix = '/') {
    const app = express();
    app.use(bodyParser.json());
    app.use(prefix, api.getRouter());
    return request(app);
}
