import log from 'log';
import {
    EventTypes,
    MAX_EMAIL_LENGTH,
    Player,
    StatusCodes,
    validateEmail,
    validatePlayerName,
    WebsocketEvent,
} from '@dyesoft/alea-core';
import { APIError, APIRouteDefinition, PaginationResponse } from './common.mjs';

const logger = log.get('api:player');

/* API route definition for player-related endpoints. */
class PlayerAPI extends APIRouteDefinition {
    /* Create a new Player API using the given database connection and mailer. */
    constructor(db, wss, mailer) {
        super(db, wss, mailer);
        this.get('/', this.handleGetPlayers.bind(this));
        this.post('/', this.handleCreatePlayer.bind(this));
        this.post('/retrieve', this.handleRetrievePlayer.bind(this));
        this.get('/:playerID', this.handleGetPlayer.bind(this));
        this.patch('/:playerID', this.handleUpdatePlayer.bind(this));
    }

    /* Validate the request body to ensure that it contains a valid player. */
    async validatePlayer(req, existingEmail = null) {
        const name = req.body.name?.toString().trim();
        if (!validatePlayerName(name)) {
            throw new APIError(`Invalid name "${name}"`, StatusCodes.BAD_REQUEST);
        }

        let email = null;
        if (req.body.hasOwnProperty('email')) {
            email = req.body.email.toString().trim();
            if (email !== '') {
                if (email.length > MAX_EMAIL_LENGTH || !validateEmail(email)) {
                    throw new APIError(`Invalid email "${email}"`, StatusCodes.BAD_REQUEST);
                }
                if (existingEmail === null || email !== existingEmail) {
                    const existingPlayer = await this.db.players.getByEmail(email);
                    if (existingPlayer) {
                        logger.error(`Error creating player: Player with email "${email}" already exists`);
                        throw new APIError(`Player with email "${email}" already exists`, StatusCodes.CONFLICT);
                    }
                }
            }
        }

        return new Player(name, email);
    }

    /* Handler for GET /player. */
    async handleGetPlayers(req, res, error) {
        if (req.query.hasOwnProperty('email')) {
            const player = await this.db.players.getByEmail(req.query.email.trim());
            const found = !!player;
            let players = [];
            if (found) {
                players.push(player);
            }
            res.json(new PaginationResponse(false, (found ? 1 : 0), 1, players, 'players'));
            return;
        }

        const activeParam = req.query.active;
        let active = null;
        if (activeParam) {
            active = activeParam.toLowerCase();
            if (active !== 'true' && active !== 'false') {
                error(`Invalid active filter "${activeParam}"`, StatusCodes.BAD_REQUEST);
                return;
            }
            active = (active === 'true');
        }

        let response;
        try {
            response = await this.getPaginationResponse(req, 'players', this.db.players.count, this.db.players.getPageOfPlayers, [active]);
        } catch (e) {
            error(e.message, e.status);
            return;
        }

        res.json(response);
    }

    /* Handler for POST /player. */
    async handleCreatePlayer(req, res, error) {
        let player;
        try {
            player = await this.validatePlayer(req);
        } catch (e) {
            logger.error(`Error creating player: ${e.message}`);
            error(e.message, e.status);
            return;
        }

        const roomID = req.body.roomID?.toString().trim();
        if (roomID) {
            const room = await this.db.rooms.getByID(roomID);
            if (!room) {
                logger.error(`Error creating player: Room "${roomID}" not found`);
                error(`Room "${roomID}" not found`, StatusCodes.NOT_FOUND);
                return;
            }
        }

        try {
            await this.db.players.create(player);
            if (roomID) {
                await this.db.rooms.addPlayerToRoom(roomID, player.playerID);
            }
        } catch (e) {
            logger.error(`Failed to save player to database: ${e}`);
            error('Failed to save player to database', StatusCodes.INTERNAL_SERVER_ERROR);
            return;
        }

        res.json(player);
        this.wss.broadcast(new WebsocketEvent(EventTypes.PLAYER_JOINED, {player}));
        logger.info(`Created player ${player.playerID}.`);

        if (!!player.email && player.email !== '') {
            await this.mailer.sendPlayerRegisteredMessage(player);
        }
    }

    /* Handler for POST /player/retrieve. */
    async handleRetrievePlayer(req, res, error) {
        const email = req.body.email?.toString().trim();
        if (!validateEmail(email)) {
            logger.error(`Error retrieving player by email: Invalid email "${email}"`);
            error(`Invalid email "${email}"`, StatusCodes.BAD_REQUEST);
            return;
        }

        const player = await this.db.players.getByEmail(email);
        if (!player) {
            logger.error(`Error retrieving player by email: Player with email "${email}" not found`);
            error(`Player with email "${email}" not found`, StatusCodes.NOT_FOUND);
            return;
        }

        res.status(StatusCodes.NO_CONTENT).end();
        await this.mailer.sendPlayerRetrievalMessage(player);
        logger.info(`Sent player retrieval email to ${player.name} at ${email} (player ID: ${player.playerID}).`);
    }

    /* Handler for GET /player/:playerID. */
    async handleGetPlayer(req, res, error) {
        const playerID = req.params.playerID;
        const player = await this.db.players.getByID(playerID);
        if (player) {
            res.json(player);
        } else {
            error(`Player "${playerID}" not found`, StatusCodes.NOT_FOUND);
        }
    }

    /* Handler for PATCH /player/:playerID. */
    async handleUpdatePlayer(req, res, error) {
        const playerID = req.params.playerID;
        const player = await this.db.players.getByID(playerID);
        if (!player) {
            logger.error(`Error updating player: Player "${playerID}" not found`);
            error(`Player "${playerID}" not found`, StatusCodes.NOT_FOUND);
            return;
        }

        let newPlayer;
        try {
            newPlayer = await this.validatePlayer(req, player.email || '');
        } catch (e) {
            logger.error(`Error updating player ${playerID}: ${e.message}`);
            error(e.message, e.status);
            return;
        }

        try {
            await this.db.players.updateNameAndEmailByID(playerID, newPlayer.name, newPlayer.email);
        } catch (e) {
            logger.error(`Failed to update player ${playerID} in database: ${e}`);
            error('Failed to update player in database', StatusCodes.INTERNAL_SERVER_ERROR);
            return;
        }

        if (newPlayer.name !== player.name || (newPlayer.email || '') !== (player.email || '')) {
            if (newPlayer.name !== player.name) {
                logger.info(`Player ${playerID} changed name from "${player.name}" to "${newPlayer.name}".`);
                this.wss.playerNames[playerID] = newPlayer.name;
            }
            if ((newPlayer.email || '') !== (player.email || '')) {
                logger.info(`${newPlayer.name} changed email from "${player.email || ''}" to "${newPlayer.email || ''}".`);
            }
            this.wss.broadcast(new WebsocketEvent(EventTypes.PLAYER_CHANGED_SETTINGS, {playerID, name: newPlayer.name, email: newPlayer.email, prevName: player.name, roomID: player.currentRoomID}));
        }
        res.status(StatusCodes.NO_CONTENT).end();

        if ((newPlayer.email || '') !== (player.email || '') && (newPlayer.email || '') !== '' && (player.email || '') !== '') {
            await this.mailer.sendPlayerEmailUpdatedMessage(newPlayer.name, newPlayer.email, player.email);
        }
    }
}

export default PlayerAPI;
