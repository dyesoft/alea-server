import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { TEST_SMTP_HOST } from './mail.mjs';
import Server from './server.mjs';

describe('Server', () => {
    // NOTE: The /api prefix will be added by the constructor.
    const expectedDefaultRoutes = [
        'game',
        'player',
        'request',
        'room',
        'status',
    ];

    describe('constructor', () => {
        test('sets expected fields', () => {
            const config = {};
            const mockDB = {};
            const mockMailer = {};
            const mockWSS = {
                handleWebsocket: jest.fn(),
            };
            const server = new Server(config, mockDB, mockMailer, mockWSS);
            expect(server.config).toBe(config);
            expect(server.db).toBe(mockDB);
            expect(server.mailer).toBe(mockMailer);
            expect(server.wss).toBe(mockWSS);
            expect(server.logRequests).toBeDefined();
            expect(server.port).toBeDefined();
            expect(server.app).toBeDefined();
            expect(Object.keys(server.routes)).toEqual(expectedDefaultRoutes);
        });
    });

    describe('new', () => {
        const mockDB = {
            close: jest.fn(),
        };

        const mockWSS = {
            handleWebsocket: jest.fn(),
        };

        let server;

        afterEach(async () => {
            await server.stop();
        });

        test('with config', async () => {
            const port = 6543;
            const config = {
                admin: {},
                db: {
                    url: global.__MONGO_URI__,
                },
                server: {
                    port: port,
                    logRequests: true,
                },
                smtp: {
                    host: TEST_SMTP_HOST,
                },
                messages: {},
            };
            server = await Server.new(config);
            expect(server.config).toBe(config);
            expect(server.logRequests).toBeTruthy();
            expect(server.port).toEqual(port);
            expect(server.db).toBeDefined();
            expect(server.mailer).toBeDefined();
            expect(server.wss).toBeDefined();
            expect(server.app).toBeDefined();
            expect(server.server).toBeDefined();
            expect(Object.keys(server.routes)).toEqual(expectedDefaultRoutes);
        });

        test('with config, DB, mailer, and websocket server', async () => {
            const config = {};
            const mockMailer = {};
            server = await Server.new(config, mockDB, mockMailer, mockWSS);
            expect(server.config).toBe(config);
            expect(server.db).toBe(mockDB);
            expect(server.mailer).toBe(mockMailer);
            expect(server.wss).toBe(mockWSS);
            expect(server.logRequests).toBeDefined();
            expect(server.port).toBeDefined();
            expect(server.app).toBeDefined();
            expect(server.server).toBeDefined();
            expect(Object.keys(server.routes)).toEqual(expectedDefaultRoutes);
        });

        test('additional custom routes', async () => {
            const mockRouteDef = {
                getRouter: jest.fn().mockReturnValue({}),
            };
            const path = '/test';
            const routes = {
                [path]: jest.fn().mockReturnValue(mockRouteDef),
            };
            server = await Server.new({}, mockDB, {}, mockWSS, routes);
            expect(Object.keys(server.routes)).toEqual(expectedDefaultRoutes.concat(Object.keys(routes)));
            expect(routes[path]).toHaveBeenCalledWith(server);
            expect(mockRouteDef.getRouter).toHaveBeenCalled();
        });

        test('override default routes', async () => {
            const mockRouteDef = {
                getRouter: jest.fn().mockReturnValue({}),
            };
            const routes = {
                game: jest.fn().mockReturnValue(mockRouteDef),
            };
            server = await Server.new({}, mockDB, {}, mockWSS, routes);
            expect(Object.keys(server.routes)).toEqual(expectedDefaultRoutes);
            expect(routes.game).toHaveBeenCalledWith(server);
            expect(mockRouteDef.getRouter).toHaveBeenCalled();
        });
    });

    describe('run', () => {
        const mockWSS = {
            handleWebsocket: jest.fn(),
        };
        const server = new Server({}, {}, {}, mockWSS);

        test('starts server listening on configured port', () => {
            const mockHTTPServer = {
                listening: false,
                listen: jest.fn(),
            };
            server.server = mockHTTPServer;
            server.run();
            expect(mockHTTPServer.listen).toHaveBeenCalledWith(server.port);
        });

        test('does nothing if server already listening', () => {
            const mockHTTPServer = {
                listening: true,
                listen: jest.fn(),
            };
            server.server = mockHTTPServer;
            server.run();
            expect(mockHTTPServer.listen).not.toHaveBeenCalled();
        });
    });

    describe('stop', () => {
        const mockWSS = {
            handleWebsocket: jest.fn(),
        };

        test('closes server and DB connections', async () => {
            const mockDB = {
                close: jest.fn(),
            };
            const mockHTTPServer = {
                listening: true,
                close: jest.fn(),
            };
            const server = new Server({}, mockDB, {}, mockWSS);
            server.server = mockHTTPServer;
            await server.stop();
            expect(mockHTTPServer.close).toHaveBeenCalled();
            expect(mockDB.close).toHaveBeenCalled();
        });

        test('does not close server if not listening', async () => {
            const mockDB = {
                close: jest.fn(),
            };
            const mockHTTPServer = {
                listening: false,
                close: jest.fn(),
            };
            const server = new Server({}, mockDB, {}, mockWSS);
            server.server = mockHTTPServer;
            await server.stop();
            expect(mockHTTPServer.close).not.toHaveBeenCalled();
            expect(mockDB.close).toHaveBeenCalled();
        });
    });
});
