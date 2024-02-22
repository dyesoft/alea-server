import MongoCollection from './collection.mjs';

/* Data access class for working with games. */
export default class GameCollection extends MongoCollection {
    /* Create a new game collection using the given database. */
    constructor(db) {
        super(db, 'games', 'gameID');
    }

    /* Add the given player to the given game. */
    async addPlayerToGame(gameID, playerID) {
        await this.updateFieldsByID(gameID, {
            $set: {[`scores.${playerID}`]: 0},
            $addToSet: {playerIDs: playerID},
        });
    }
}
