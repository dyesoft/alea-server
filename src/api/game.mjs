import log from 'log';
import {EventTypes, Game, PlayerStatsKeys, StatusCodes, WebsocketEvent} from '@dyesoft/alea-core';
import { APIRouteDefinition } from './common.mjs';

const logger = log.get('api:game');

/* API route definition for game-related endpoints. */
class GameAPI extends APIRouteDefinition {
    /* Create a new Game API using the given database connection. */
    constructor(db, wss, maxPlayersPerGame = null) {
        super(db, wss);
        this.maxPlayersPerGame = maxPlayersPerGame || null;
        this.post('/', this.handleCreateGame.bind(this));
        this.get('/:gameID', this.handleGetGame.bind(this));
    }

    /*
     * Abstract method to validate the request body to ensure that it contains a valid game.
     * This method should be overridden by subclasses to perform necessary validation.
     */
    async validateNewGame(req) {
        // Do nothing by default.
    }

    /*
     * Abstract method to create a new game for a given request, which has already been validated.
     * This method should be overridden by subclasses to create and return a game with the appropriate fields populated.
     */
    async createNewGame(req, roomID, playerIDs) {
        return new Game(roomID, playerIDs);
    }

    /* Handler for POST /game. */
    async handleCreateGame(req, res, error) {
        logger.info('Creating a new game.');

        const roomID = req.body.roomID?.toString().trim();
        const room = await this.db.rooms.getByID(roomID);
        if (!room) {
            error(`Room "${roomID}" not found`, StatusCodes.NOT_FOUND);
            return;
        }

        let playerIDs = [];
        let players = [];
        if (req.body.hasOwnProperty('playerIDs')) {
            playerIDs = req.body.playerIDs;
            try {
                players = await this.db.players.getByIDs(playerIDs);
            } catch (e) {
                logger.error(`Failed to get players: ${e}`);
                error('Failed to get players', StatusCodes.NOT_FOUND);
                return;
            }
            const numPlayers = players.filter(player => !player.spectating).length;
            if (this.maxPlayersPerGame && this.maxPlayersPerGame > 0 && numPlayers > this.maxPlayersPerGame) {
                error(`Maximum number of players (${this.maxPlayersPerGame}) exceeded`, StatusCodes.BAD_REQUEST);
                return;
            }
        }

        try {
            await this.validateNewGame(req);
        } catch (e) {
            error(e.message, e.status);
            return;
        }

        this.wss.broadcast(new WebsocketEvent(EventTypes.GAME_STARTING, {roomID}));

        let game;
        try {
            game = await this.createNewGame(req, roomID, playerIDs);
        } catch (e) {
            logger.error(`Failed to create new game from request: ${e}`);
            error(e.message, e.status);
            return;
        }

        try {
            await this.db.games.create(game);
        } catch (e) {
            error(`Failed to save game to database: ${e}`, StatusCodes.INTERNAL_SERVER_ERROR);
            return;
        }

        try {
            await this.db.rooms.setCurrentGameForRoom(room, game.gameID);
            await Promise.all(game.playerIDs.map(playerID => this.db.players.incrementStat(playerID, PlayerStatsKeys.GAMES_PLAYED)));
        } catch (e) {
            logger.error(`Failed to handle processing of new game ${game.gameID} for room ${roomID}: ${e}`);
        }

        res.json(game);
        this.wss.broadcast(new WebsocketEvent(EventTypes.GAME_STARTED, {roomID, game}));
        logger.info(`Created game ${game.gameID}.`);
    }

    /* Handler for GET /game/:gameID. */
    async handleGetGame(req, res, error) {
        const gameID = req.params.gameID;
        const game = await this.db.games.getByID(gameID);
        if (game) {
            res.json(game);
        } else {
            error(`Game "${gameID}" not found`, StatusCodes.NOT_FOUND);
        }
    }
}

export default GameAPI;
