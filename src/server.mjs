import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import expressWs from 'express-ws';
import fs from 'fs';
import http from 'http';
import https from 'https';
import log from 'log';
import { apiErrorHandler, apiRequestLogHandler, apiResponseLogHandler } from './api/common.mjs';
import GameAPI from './api/game.mjs';
import PlayerAPI from './api/player.mjs';
import RoomAPI from './api/room.mjs';
import RoomLinkRequestAPI from './api/roomLinkRequest.mjs';
import StatusAPI from './api/status.mjs';
import { MongoDB } from './database/index.mjs';
import { Mailer } from './mail.mjs';
import { WebsocketServer } from './websockets.mjs';

const DEFAULT_PORT = 3456;

const DEFAULT_ROUTES = {
    game: (server) => new GameAPI(server.db, server.wss, server.config.game?.maxPlayersPerGame),
    player: (server) => new PlayerAPI(server.db, server.wss, server.mailer),
    request: (server) => new RoomLinkRequestAPI(server.db, server.mailer),
    room: (server) => new RoomAPI(server.db, server.wss, server.mailer, server.config.admin?.playerIDs),
    status: (server) => new StatusAPI(server.db, server.config.packageVersion),
};

const logger = log.get('server');
const requestLogger = log.get('api');

/* Server encapsulates the route definitions and resources needed to run an instance of the API server. */
export default class Server {
    /*
     * Create a new server using the given configuration and resources.
     * NOTE: The static factory method Server.new() should typically be used instead of invoking this constructor!
     */
    constructor(config, db, mailer, wss, routes = {}) {
        this.config = config || {};
        this.db = db;
        this.mailer = mailer;
        this.wss = wss;
        this.logRequests = this.config.server?.logRequests ?? false;
        this.port = this.config.server?.port || DEFAULT_PORT;
        this.app = express();

        if (this.config.ssl?.certPath && this.config.ssl?.keyPath) {
            const serverOptions = {
                cert: fs.readFileSync(this.config.ssl.certPath),
                key: fs.readFileSync(this.config.ssl.keyPath)
            };
            this.server = https.createServer(serverOptions, this.app);
        } else {
            this.server = http.createServer(this.app);
        }

        expressWs(this.app, this.server);
        this.app.use(bodyParser.json());
        this.app.use(cors());

        if (this.logRequests) {
            this.app.use(apiRequestLogHandler(requestLogger));
        }

        this.routes = {...DEFAULT_ROUTES, ...routes || {}};
        Object.entries(this.routes).forEach(([path, routeFactory]) => {
            if (path.startsWith('/')) {
                path = path.substring(1);
            }
            path = `/api/${path}`;
            try {
                const routeDef = routeFactory(this);
                if (routeDef) {
                    this.app.use(path, routeDef.getRouter());
                }
            } catch (e) {
                logger.error(`Failed to initialize ${path} routes: ${e}`);
            }
        });

        this.app.use(apiErrorHandler);

        if (this.logRequests) {
            this.app.use(apiResponseLogHandler(requestLogger));
        }

        this.app.ws('/api/ws', this.wss.handleWebsocket);
    }

    /* Return a new Server using the given config and optional database, mailer, websocket server, and override routes. */
    static async new(config, db = null, mailer = null, wss = null, routes = {}) {
        config = config || {};
        if (!db) {
            db = await MongoDB.new(config);
        }
        if (!mailer) {
            mailer = await Mailer.new(config);
        }
        if (!wss) {
            wss = new WebsocketServer(db, config);
        }
        return new Server(config, db, mailer, wss, routes);
    }

    /* Run the server on the configured port. */
    run() {
        if (!this.server.listening) {
            this.server.listen(this.port);
        }
    }

    /* Stop the server and close the connection to the database. */
    async stop() {
        if (this.server.listening) {
            await this.server.close();
        }
        await this.db.close();
    }
}
