import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import expressWs from 'express-ws';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { apiErrorHandler } from './api/common.mjs';
import GameAPI from './api/game.mjs';
import PlayerAPI from './api/player.mjs';
import RoomAPI from './api/room.mjs';
import RoomLinkRequestAPI from './api/roomLinkRequest.mjs';
import StatusAPI from './api/status.mjs';
import { WebsocketServer } from './websockets.mjs';

/* Server encapsulates the route definitions and resources needed to run an instance of the API server. */
class Server {
    /* Create a new server using the given configuration and database connection. */
    constructor(config, db, mailer) {
        this.app = express();
        this.wss = new WebsocketServer(db, config.maxPlayersPerGame);

        if (config.ssl && config.ssl.certPath && config.ssl.keyPath) {
            const serverOptions = {
                cert: fs.readFileSync(config.ssl.certPath),
                key: fs.readFileSync(config.ssl.keyPath)
            };
            this.server = https.createServer(serverOptions, this.app);
        } else {
            this.server = http.createServer(this.app);
        }

        expressWs(this.app, this.server);

        this.app.use(bodyParser.json());
        this.app.use(cors());
        this.app.use('/api/game', new GameAPI(db, wss, config.maxPlayersPerGame).getRouter());
        this.app.use('/api/player', new PlayerAPI(db, wss, mailer).getRouter());
        this.app.use('/api/room', new RoomAPI(db, wss, mailer, config.adminPlayerIDs).getRouter());
        this.app.use('/api/request', new RoomLinkRequestAPI(db, mailer).getRouter());
        this.app.use('/api/status', new StatusAPI(db, config.packageVersion).getRouter());
        this.app.use(apiErrorHandler);
        this.app.ws('/api/ws', this.wss.handleWebsocket);
    }

    /* TODO */
    use(path, router) {
        this.app.use(path, router);
    }

    /* TODO */
    run(port) {
        this.server.listen(port);
    }
}
