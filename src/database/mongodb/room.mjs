import MongoCollection from './collection.mjs';

import {
    randomChoice,
    range,
    ROOM_CODE_CHARACTERS,
    ROOM_CODE_LENGTH,
} from '@dyesoft/alea-core';

const ROOM_HISTORY_GAME_PROJECTION = {
    _id: 0,
    roomID: 0,
    rounds: 0,
};

const ROOM_HISTORY_PLAYER_PROJECTION = {
    _id: 0,
    active: 0,
    currentRoomID: 0,
    email: 0,
    spectating: 0,
    stats: 0,
};

const ROOM_HISTORY_ROOM_PROJECTION = {
    _id: 0,
    kickedPlayerIDs: 0,
    passwordHash: 0,
    playerIDs: 0,
    players: ROOM_HISTORY_PLAYER_PROJECTION,
    previousGameIDs: 0,
    previousGames: ROOM_HISTORY_GAME_PROJECTION,
};

/* Data access class for working with rooms. */
export default class RoomCollection extends MongoCollection {
    /* Create a new room collection using the given database. */
    constructor(db) {
        super(db, 'rooms', 'roomID');

        this.projections = {
            roomHistory: ROOM_HISTORY_ROOM_PROJECTION,
        };

        this.create = this.create.bind(this);
        this.generateUniqueRoomCode = this.generateUniqueRoomCode.bind(this);
        this.getByRoomCode = this.getByRoomCode.bind(this);
        this.setCurrentGameForRoom = this.setCurrentGameForRoom.bind(this);
        this.addPlayerToRoom = this.addPlayerToRoom.bind(this);
        this.removePlayerFromRoom = this.removePlayerFromRoom.bind(this);
        this.removePlayerFromKickedPlayersInRoom = this.removePlayerFromKickedPlayersInRoom.bind(this);
        this.getHistoryByID = this.getHistoryByID.bind(this);
        this.getHistoryByRoomCode = this.getHistoryByRoomCode.bind(this);
        this.getHistoryByCriteria = this.getHistoryByCriteria.bind(this);
    }

    /* Create a new room in the collection. */
    async create(room) {
        if (!room.roomCode) {
            room.roomCode = await this.generateUniqueRoomCode();
        }
        await super.create(room);
    }

    /* Generate and return a random room code that is not already in use by another room. */
    async generateUniqueRoomCode() {
        let code, room;
        while (!code || room) {
            code = range(ROOM_CODE_LENGTH).map(_ => randomChoice(ROOM_CODE_CHARACTERS)).join('');
            room = await this.getByRoomCode(code);
        }
        return code;
    }

    /* Return the room with the given room code. */
    async getByRoomCode(roomCode) {
        return await this.collection.findOne({roomCode: roomCode});
    }

    /* Set the current game for the given room, optionally updating the current champion. */
    async setCurrentGameForRoom(room, gameID, currentChampion) {
        if (room.currentGameID !== gameID) {
            let updates = {
                $set: {
                    currentGameID: gameID,
                },
            };
            if (room.currentGameID) {
                updates.$addToSet = {
                    previousGameIDs: room.currentGameID,
                };
            }
            if (currentChampion !== undefined) {
                if (currentChampion && currentChampion === room.currentChampion) {
                    updates.$set.currentWinningStreak = room.currentWinningStreak + 1;
                } else {
                    updates.$set.currentChampion = currentChampion;
                    updates.$set.currentWinningStreak = (currentChampion ? 1 : 0);
                }
            }
            await this.updateFieldsByID(room.roomID, updates);
        }
    }

    /* Add the given player to the given room. */
    async addPlayerToRoom(roomID, playerID) {
        await this.updateFieldsByID(roomID, {$addToSet: {playerIDs: playerID}});
    }

    /* Remove the given player from the given room, optionally updating the room's host. */
    async removePlayerFromRoom(roomID, playerID, newHostPlayerID = null) {
        let updates = {$pull: {playerIDs: playerID}};
        if (newHostPlayerID) {
            updates.$set = {hostPlayerID: newHostPlayerID};
        }
        await this.updateFieldsByID(roomID, updates);
    }

    /* Remove the given player from the list of kicked players in the given room. */
    async removePlayerFromKickedPlayersInRoom(roomID, playerID) {
        await this.updateFieldsByID(roomID, {$unset: {[`kickedPlayerIDs.${playerID}`]: ''}});
    }

    /* Return the history of games for the given room by ID. */
    async getHistoryByID(roomID) {
        return await this.getHistoryByCriteria({roomID: roomID});
    }

    /* Return the history of games for the given room by room code. */
    async getHistoryByRoomCode(roomCode) {
        return await this.getHistoryByCriteria({roomCode: roomCode});
    }

    /* Return the history of games for the first room matching the given criteria. */
    async getHistoryByCriteria(criteria) {
        const cursor = await this.collection.aggregate([
            {$match: criteria},
            {$lookup: {
                from: 'games',
                localField: 'previousGameIDs',
                foreignField: 'gameID',
                as: 'previousGames',
            }},
            {$lookup: {
                from: 'players',
                localField: 'previousGames.playerIDs',
                foreignField: 'playerID',
                as: 'players',
            }},
            {$project: this.projections.roomHistory},
        ]);
        const results = await cursor.toArray();
        if (!results.length) {
            return null;
        }
        return results.pop();
    }
}
