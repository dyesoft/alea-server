import MongoCollection from './collection.mjs';

/* Data access class for working with players. */
export default class PlayerCollection extends MongoCollection {
    /* Create a new player collection using the given database. */
    constructor(db) {
        super(db, 'players', 'playerID');

        this.count = this.count.bind(this);
        this.getPageOfPlayers = this.getPageOfPlayers.bind(this);
        this.getByEmail = this.getByEmail.bind(this);
        this.updateNameAndEmailByID = this.updateNameAndEmailByID.bind(this);
    }

    /* Return the total number of players in the collection, optionally filtered by active status. */
    async count(active = null) {
        let filters = {};
        if (active !== null) {
            filters.active = active;
        }
        return super.count(filters);
    }

    /* Return a paginated list of players for the given page number, optionally filtered by active status. */
    async getPageOfPlayers(page, active = null) {
        let filters = {};
        if (active !== null) {
            filters.active = active;
        }
        return await this.getPaginatedList(page, {lastConnectionTime: -1}, filters);
    }

    /* Return the player with the given email. */
    async getByEmail(email) {
        return await this.collection.findOne({email: email});
    }

    /* Update the given player's name and email. */
    async updateNameAndEmailByID(playerID, name, email) {
        await this.updateByID(playerID, {name: name, email: email});
    }

    /* Increment the given statistic for the given player by the given amount (or 1). */
    async incrementStat(playerID, statName, value = 1) {
        const key = `stats.${statName}`;
        await this.updateFieldsByID(playerID, {$inc: {[key]: value}});
    }

    /* Set the given statistic for the given player to the given value. */
    async setStat(playerID, statName, value) {
        const key = `stats.${statName}`;
        await this.updateByID(playerID, {[key]: value});
    }
}
