import { describe, expect, jest, test } from '@jest/globals';
import { TEST_SMTP_HOST } from './mail.mjs';
import Server from './server.mjs';

describe('Server', () => {
    describe('constructor', () => {
        // NOTE: The /api prefix will be added by the constructor.
        const expectedDefaultRoutes = [
            'game',
            'player',
            'request',
            'room',
            'status',
        ];

        test('with config', () => {
            const port = 6543;
            const config = {
                admin: {},
                db: {
                    url: global.__MONGO_URI__,
                },
                server: {
                    port: port,
                },
                smtp: {
                    host: TEST_SMTP_HOST,
                },
                messages: {},
            };
            const server = new Server(config);
            expect(server.config).toBe(config);
            expect(server.port).toEqual(port);
            expect(server.db).toBeDefined();
            expect(server.mailer).toBeDefined();
            expect(server.wss).toBeDefined();
            expect(server.app).toBeDefined();
            expect(server.server).toBeDefined();
            expect(Object.keys(server.routes)).toEqual(expectedDefaultRoutes);
        });

        test('with config, DB, and mailer', () => {
            const config = {};
            const mockDB = {};
            const mockMailer = {};
            const server = new Server(config, mockDB, mockMailer);
            expect(server.config).toBe(config);
            expect(server.db).toBe(mockDB);
            expect(server.mailer).toBe(mockMailer);
            expect(server.port).toBeDefined();
            expect(server.wss).toBeDefined();
            expect(server.app).toBeDefined();
            expect(server.server).toBeDefined();
            expect(Object.keys(server.routes)).toEqual(expectedDefaultRoutes);
        });

        test('additional custom routes', () => {
            const mockDB = {};
            const mockMailer = {};
            const mockRouteDef = {
                getRouter: jest.fn().mockReturnValue({}),
            };
            const path = '/test';
            const routes = {
                [path]: jest.fn().mockReturnValue(mockRouteDef),
            };
            const server = new Server({}, mockDB, mockMailer, routes);
            expect(Object.keys(server.routes)).toEqual(expectedDefaultRoutes.concat(Object.keys(routes)));
            expect(routes[path]).toHaveBeenCalledWith(server);
            expect(mockRouteDef.getRouter).toHaveBeenCalled();
        });

        test('override default routes', () => {
            const mockDB = {};
            const mockMailer = {};
            const mockRouteDef = {
                getRouter: jest.fn().mockReturnValue({}),
            };
            const routes = {
                game: jest.fn().mockReturnValue(mockRouteDef),
            };
            const server = new Server({}, mockDB, mockMailer, routes);
            expect(Object.keys(server.routes)).toEqual(expectedDefaultRoutes);
            expect(routes.game).toHaveBeenCalledWith(server);
            expect(mockRouteDef.getRouter).toHaveBeenCalled();
        });
    });

    describe('init', () => {
        test('initializes DB and mailer', async () => {
            const mockDB = {
                init: jest.fn(),
            };
            const mockMailer = {
                init: jest.fn(),
            };
            const server = new Server({}, mockDB, mockMailer);
            await server.init();
            expect(mockDB.init).toHaveBeenCalled();
            expect(mockMailer.init).toHaveBeenCalled();
        });
    });

    describe('run', () => {
        const server = new Server({}, {}, {});

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
        test('closes server and DB connections', async () => {
            const mockDB = {
                close: jest.fn(),
            };
            const mockHTTPServer = {
                listening: true,
                close: jest.fn(),
            };
            const server = new Server({}, mockDB, {});
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
            const server = new Server({}, mockDB, {});
            server.server = mockHTTPServer;
            await server.stop();
            expect(mockHTTPServer.close).not.toHaveBeenCalled();
            expect(mockDB.close).toHaveBeenCalled();
        });
    });
});
