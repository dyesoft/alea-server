import MongoCollection from './collection.mjs';

import {
    randomChoice,
    range,
    ROOM_CODE_CHARACTERS,
    ROOM_CODE_LENGTH,
} from '@dyesoft/alea-core';

/* Data access class for working with rooms. */
export default class RoomCollection extends MongoCollection {
    /* Create a new room collection using the given database. */
    constructor(db) {
        super(db, 'rooms', 'roomID');
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
            {$project: {  // TODO - projection includes some non-modeled fields
                _id: 0,
                kickedPlayerIDs: 0,
                passwordHash: 0,
                playerIDs: 0,
                players: {
                    _id: 0,
                    active: 0,
                    currentRoomID: 0,
                    email: 0,
                    preferredFontStyle: 0,
                    spectating: 0,
                    stats: 0,
                },
                previousGameIDs: 0,
                previousGames: {
                    _id: 0,
                    activeClue: 0,
                    currentWager: 0,
                    episodeMetadata: {
                        contestants: 0,
                        scores: 0,
                    },
                    playerAnswering: 0,
                    playerInControl: 0,
                    playersReadyForNextRound: 0,
                    roomID: 0,
                    rounds: 0,
                },
            }},
        ]);
        const results = await cursor.toArray();
        if (!results.length) {
            return null;
        }
        return results.pop();
    }
}
