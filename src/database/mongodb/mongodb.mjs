import mongodb from 'mongodb';
const { MongoClient } = mongodb;

import log from 'log';
import { sleep } from '../../utils.mjs';
import { MONGO_CLIENT_OPTIONS } from './constants.mjs';
import GameCollection from './game.mjs';
import PlayerCollection from './player.mjs';
import RoomCollection from './room.mjs';
import RoomLinkRequestCollection from './roomLinkRequest.mjs';

const DB_CLOSE_DELAY_MILLIS = 50;

const logger = log.get('mongodb');

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

    /* Close the underlying connection to the database. */
    async close(delay = false) {
        if (delay) {
            // Wait for a short delay before closing the connection to allow pending transactions to commit.
            // Mostly useful for testing where the connection is closed immediately when the tests finish.
            await sleep(DB_CLOSE_DELAY_MILLIS);
        }
        await this.client.close();
    }

    /* Attempt to find a new host player for the given room, assuming the current host is leaving the room. */
    async findNewHostPlayerID(room) {
        const playerIDs = room.playerIDs.filter(playerID => playerID !== room.hostPlayerID);
        let players;
        try {
            players = await this.players.getByIDs(playerIDs);
        } catch (e) {
            logger.error(`Failed to get players to find new host: ${e}`);
        }
        let newHostPlayerID;
        if (players) {
            newHostPlayerID = players.find(player => player.active && player.currentRoomID === room.roomID && !player.spectating)?.playerID;
            if (!newHostPlayerID) {
                newHostPlayerID = players.find(player => player.active && player.currentRoomID === room.roomID)?.playerID;
                if (!newHostPlayerID && room.hostPlayerID !== room.ownerPlayerID) {
                    newHostPlayerID = room.ownerPlayerID;
                }
            }
        } else {
            newHostPlayerID = room.ownerPlayerID;
        }
        return newHostPlayerID || null;
    }

    /*
     * Remove the given player from the room with the given ID (or the player's current room).
     * Returns the new host player ID for the room, or null if the host player does not need to be reassigned.
     */
    async removePlayerFromRoom(player, roomID = null) {
        if (!roomID) {
            roomID = player.currentRoomID;
        }
        const room = await this.rooms.getByID(roomID);
        let newHostPlayerID = null;
        if (room) {
            if (room.hostPlayerID === player.playerID) {
                newHostPlayerID = await this.findNewHostPlayerID(room);
            }
            await this.rooms.removePlayerFromRoom(roomID, player.playerID, newHostPlayerID);
        }
        return newHostPlayerID;
    }
}
