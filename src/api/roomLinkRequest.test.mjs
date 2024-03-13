import { RoomLinkRequest, RoomLinkRequestResolution, StatusCodes } from '@dyesoft/alea-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTestDB, getTestMailer } from '../testutils.mjs';
import RoomLinkRequestAPI from './roomLinkRequest.mjs';
import { app } from './testutils.mjs';

const REQUEST_NAME = 'Barney';
const REQUEST_EMAIL = 'barney@example.com';

describe('RoomLinkRequestAPI', () => {
    let db;
    let mailer;
    let api;

    beforeAll(async () => {
        db = await getTestDB();
        mailer = await getTestMailer();
        api = new RoomLinkRequestAPI(db, mailer);
    });

    beforeEach(async () => {
        await db.roomLinkRequests.truncate(true);
    });

    afterEach(async () => {
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await db.close();
    });

    describe('constructor', () => {
        test('with DB and mailer', () => {
            expect(api.db).toBe(db);
            expect(api.mailer).toBe(mailer);
        });

        test('creates expected routes', () => {
            expect(api._router.stack).toHaveLength(4);

            const getRoomLinkRequestsRoute = api._router.stack[0].route;
            expect(getRoomLinkRequestsRoute.path).toEqual('/');
            expect(getRoomLinkRequestsRoute.methods).toEqual({get: true});

            const createRoomLinkRequestRoute = api._router.stack[1].route;
            expect(createRoomLinkRequestRoute.path).toEqual('/');
            expect(createRoomLinkRequestRoute.methods).toEqual({post: true});

            const getRoomLinkRequestRoute = api._router.stack[2].route;
            expect(getRoomLinkRequestRoute.path).toEqual('/:requestID');
            expect(getRoomLinkRequestRoute.methods).toEqual({get: true});

            const resolveRoomLinkRequestRoute = api._router.stack[3].route;
            expect(resolveRoomLinkRequestRoute.path).toEqual('/:requestID');
            expect(resolveRoomLinkRequestRoute.methods).toEqual({put: true});
        });
    });

    describe('handleGetRoomLinkRequests', () => {
        const TEST_REQUESTS = [
            new RoomLinkRequest('Fred', 'fred@example.com'),
            new RoomLinkRequest('Betty', 'b3tty@example.com'),
            new RoomLinkRequest('Barney', 'barney@example.com'),
            new RoomLinkRequest('Wilma', 'wilma@example.com'),
        ];
        TEST_REQUESTS[0].resolution = RoomLinkRequestResolution.APPROVED;
        TEST_REQUESTS[1].resolution = RoomLinkRequestResolution.REJECTED;
        TEST_REQUESTS[2].resolution = RoomLinkRequestResolution.APPROVED;

        test('invalid page', async () => {
            const page = -1;
            const response = await app(api).get(`/?page=${page}`);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid page "${page}"`);
        });

        test('invalid resolution filter', async () => {
            const resolution = 'foo';
            const response = await app(api).get(`/?resolution=${resolution}`);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid resolution "${resolution}"`);
        });

        test('page number too high', async () => {
            const page = 2;
            const response = await app(api).get(`/?page=${page}`);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid page "${page}"`);
        });

        test('no results', async () => {
            const response = await app(api).get('/');
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual({more: false, total: 0, page: 1, requests: []});
        });

        test('successful pagination response - all requests', async () => {
            await db.roomLinkRequests.createMany(TEST_REQUESTS);
            const response = await app(api).get('/');
            expect(response.ok).toBeTruthy();
            expect(response.body.more).toBeFalsy();
            expect(response.body.total).toEqual(TEST_REQUESTS.length);
            expect(response.body.page).toEqual(1);
            expect(response.body.requests).toHaveLength(TEST_REQUESTS.length);
        });

        test('successful pagination response - approved requests only', async () => {
            await db.roomLinkRequests.createMany(TEST_REQUESTS);
            const resolution = RoomLinkRequestResolution.APPROVED;
            const response = await app(api).get(`/?resolution=${resolution}`);
            expect(response.ok).toBeTruthy();
            expect(response.body.more).toBeFalsy();
            expect(response.body.total).toEqual(2);
            expect(response.body.page).toEqual(1);
            expect(response.body.requests).toHaveLength(2);
            response.body.requests.forEach(request => expect(request.resolution).toEqual(resolution));
        });
    });

    describe('handleCreateRoomLinkRequest', () => {
        test('missing name', async () => {
            const response = await app(api).post('/');
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual('Name is required');
        });

        test('invalid name', async () => {
            const response = await app(api).post('/').send({name: ''});
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual('Invalid name ""');
        });

        test('missing email', async () => {
            const response = await app(api).post('/').send({name: REQUEST_NAME});
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual('Email is required');
        });

        test('invalid email', async () => {
            const request = {name: REQUEST_NAME, email: 'foo'};
            const response = await app(api).post('/').send(request);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid email "${request.email}"`);
        });

        test('existing unresolved request for email', async () => {
            const existingRequest = new RoomLinkRequest(REQUEST_NAME, REQUEST_EMAIL);
            await db.roomLinkRequests.create(existingRequest);

            const request = {name: 'New Fred', email: existingRequest.email};
            const response = await app(api).post('/').send(request);
            expect(response.status).toEqual(StatusCodes.CONFLICT);
            expect(response.body.error).toEqual(`Room link request already exists for email "${existingRequest.email}"`);
        });

        test('successful creation', async () => {
            const spy = jest.spyOn(mailer, 'sendRoomLinkRequestCreatedMessage');
            const request = {name: REQUEST_NAME, email: REQUEST_EMAIL};
            const response = await app(api).post('/').send(request);
            expect(response.ok).toBeTruthy();
            expect(response.body.requestID).toBeDefined();
            expect(response.body.name).toEqual(request.name);
            expect(response.body.email).toEqual(request.email);
            expect(response.body.resolution).toEqual(RoomLinkRequestResolution.UNRESOLVED);
            expect(response.body.roomID).toBeNull();
            expect(response.body.roomCode).toBeNull();
            expect(response.body.createdTime).toBeDefined();
            expect(response.body.resolvedTime).toBeNull();

            const newRequest = await db.roomLinkRequests.getByID(response.body.requestID);
            expect(newRequest.requestID).toEqual(response.body.requestID);
            expect(newRequest.name).toEqual(request.name);
            expect(newRequest.email).toEqual(request.email);
            expect(newRequest.createdTime.toISOString()).toEqual(response.body.createdTime);

            expect(spy).toHaveBeenCalledWith(newRequest);
        });
    });

    describe('handleGetRoomLinkRequest', () => {
        test('existing request', async () => {
            const request = new RoomLinkRequest(REQUEST_NAME, REQUEST_EMAIL);
            await db.roomLinkRequests.create(request);
            request.createdTime = request.createdTime.toISOString();

            const response = await app(api).get(`/${request.requestID}`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual(request);
        });

        test('request not found', async () => {
            const requestID = 'request';
            const response = await app(api).get(`/${requestID}`);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Room link request "${requestID}" not found`);
        });
    });

    describe('handleResolveRoomLinkRequest', () => {
        let existingRequest;

        beforeEach(async () => {
            existingRequest = new RoomLinkRequest(REQUEST_NAME, REQUEST_EMAIL);
            await db.roomLinkRequests.create(existingRequest);
        });

        test('request not found', async () => {
            const requestID = 'request';
            const response = await app(api).put(`/${requestID}`);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Room link request "${requestID}" not found`);
        });

        test('request already resolved', async () => {
            await db.roomLinkRequests.resolveByID(existingRequest.requestID, RoomLinkRequestResolution.APPROVED, new Date());
            const response = await app(api).put(`/${existingRequest.requestID}`);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Room link request "${existingRequest.requestID}" is already resolved`);
        });

        test('missing resolution', async () => {
            const response = await app(api).put(`/${existingRequest.requestID}`);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual('Resolution is required');
        });

        test('invalid resolution', async () => {
            const request = {resolution: 'invalid'};
            const response = await app(api).put(`/${existingRequest.requestID}`).send(request);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid resolution "${request.resolution}"`);
        });

        test('successful resolution - rejected', async () => {
            const spy = jest.spyOn(mailer, 'sendRoomLinkRequestApprovedMessage');
            const request = {resolution: RoomLinkRequestResolution.REJECTED};
            const response = await app(api).put(`/${existingRequest.requestID}`).send(request);
            expect(response.ok).toBeTruthy();
            expect(response.body.requestID).toEqual(existingRequest.requestID);
            expect(response.body.name).toEqual(existingRequest.name);
            expect(response.body.email).toEqual(existingRequest.email);
            expect(response.body.resolution).toEqual(request.resolution);
            expect(response.body.roomID).toBeNull();
            expect(response.body.roomCode).toBeNull();
            expect(response.body.createdTime).toEqual(existingRequest.createdTime.toISOString());
            expect(response.body.resolvedTime).toBeDefined();

            const newRequest = await db.roomLinkRequests.getByID(existingRequest.requestID);
            expect(newRequest.requestID).toEqual(existingRequest.requestID);
            expect(newRequest.resolution).toEqual(request.resolution);
            expect(newRequest.resolvedTime.toISOString()).toEqual(response.body.resolvedTime);

            expect(spy).not.toHaveBeenCalled();
        });

        test('successful resolution - approved', async () => {
            const spy = jest.spyOn(mailer, 'sendRoomLinkRequestApprovedMessage');
            const request = {resolution: RoomLinkRequestResolution.APPROVED};
            const response = await app(api).put(`/${existingRequest.requestID}`).send(request);
            expect(response.ok).toBeTruthy();
            expect(response.body.requestID).toEqual(existingRequest.requestID);
            expect(response.body.resolution).toEqual(request.resolution);
            expect(response.body.resolvedTime).toBeDefined();

            const newRequest = await db.roomLinkRequests.getByID(existingRequest.requestID);
            expect(newRequest.requestID).toEqual(existingRequest.requestID);
            expect(newRequest.resolution).toEqual(request.resolution);
            expect(newRequest.resolvedTime.toISOString()).toEqual(response.body.resolvedTime);

            expect(spy).toHaveBeenCalledWith(newRequest);
        });
    });
});
