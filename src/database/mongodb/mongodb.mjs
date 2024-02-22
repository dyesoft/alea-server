import mongodb from 'mongodb';
const { MongoClient } = mongodb;

import { MONGO_CLIENT_OPTIONS } from './constants.mjs';
import GameCollection from './game.mjs';
import PlayerCollection from './player.mjs';
import RoomCollection from './room.mjs';
import RoomLinkRequestCollection from './roomLinkRequest.mjs';

/* Database client that connects to a MongoDB database. */
export class MongoDB {
    /* Create a MongoDB using the given config and database name. */
    constructor(config, dbName) {
        this.url = config.db.url || `mongodb://${config.db.host}:${config.db.port}/`;
        this.dbName = dbName;
        this.client = new MongoClient(this.url, MONGO_CLIENT_OPTIONS);
        this.session = null;
        this.db = null;
        this.games = null;
        this.players = null;
        this.rooms = null;
        this.roomLinkRequests = null;
    }

    /* Initialize the underlying connection to the database. */
    async init() {
        await this.client.connect();
        this.session = this.client.startSession();
        this.db = this.client.db(this.dbName);
        this.games = new GameCollection(this.db);
        this.players = new PlayerCollection(this.db);
        this.rooms = new RoomCollection(this.db);
        this.roomLinkRequests = new RoomLinkRequestCollection(this.db);
    }
}
