import { describe, expect, jest, test } from '@jest/globals';
import { StatusCodes } from '@dyesoft/alea-core';
import { APIError, apiErrorHandler, APIRouteDefinition, PaginationResponse } from './common.mjs';

describe('APIError', () => {
    test('constructor', () => {
        const errorMessage = 'Test error';
        const status = StatusCodes.INTERNAL_SERVER_ERROR;
        const error = new APIError(errorMessage, status);
        expect(error.message).toEqual(errorMessage);
        expect(error.status).toEqual(status);
    });
});

describe('apiErrorHandler', () => {
    test('handles APIError as JSON', () => {
        const error = new APIError('Test error', StatusCodes.INTERNAL_SERVER_ERROR);
        const mockStatus = jest.fn();
        const mockJSON = jest.fn();
        const mockNext = jest.fn();
        const mockRes = {status: mockStatus, json: mockJSON};
        apiErrorHandler(error, null, mockRes, mockNext);
        expect(mockStatus).toHaveBeenCalledWith(error.status);
        expect(mockJSON).toHaveBeenCalledWith({
            error: error.message,
            status: error.status,
        });
        expect(mockNext).not.toHaveBeenCalled();
    });

    test('passes other errors to next handler', () => {
        const error = new Error('Test error');
        const mockStatus = jest.fn();
        const mockJSON = jest.fn();
        const mockNext = jest.fn();
        const mockRes = {status: mockStatus, json: mockJSON};
        apiErrorHandler(error, null, mockRes, mockNext);
        expect(mockNext).toHaveBeenCalledWith(error);
        expect(mockStatus).not.toHaveBeenCalled();
        expect(mockJSON).not.toHaveBeenCalled();
    });
});

describe('PaginationResponse', () => {
    test('constructor', () => {
        const hasMore = true;
        const total = 100;
        const currentPage = 5;
        const widgets = ['widget 1', 'widget 2', 'widget 3', 'widget 4'];
        const response = new PaginationResponse(hasMore, total, currentPage, widgets, 'widgets');
        expect(response.more).toEqual(hasMore);
        expect(response.total).toEqual(total);
        expect(response.page).toEqual(currentPage);
        expect(response.widgets).toEqual(widgets);
    });
});

describe('APIRouteDefinition', () => {
    describe('constructor', () => {
        test('no arguments', () => {
            const def = new APIRouteDefinition();
            expect(def.db).toBeNull();
            expect(def._router).toBeDefined();
        });

        test('with DB', () => {
            const mockDB = {};
            const def = new APIRouteDefinition(mockDB);
            expect(def.db).toBe(mockDB);
            expect(def._router).toBeDefined();
        });
    });

    test('getRouter', () => {
        const def = new APIRouteDefinition();
        expect(def._router).toBeDefined();
        expect(def.getRouter()).toBe(def._router);
    });

    describe('wrapHandler', () => {
        test('JSON response body', () => {
            const def = new APIRouteDefinition();
            const payload = {test: true};
            const handler = def.wrapHandler((req, res, error) => res.json(payload));
            const mockResJSON = jest.fn();
            const mockNext = jest.fn();
            handler({}, {json: mockResJSON}, mockNext);
            expect(mockResJSON).toHaveBeenCalledWith(payload);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('error response', () => {
            const def = new APIRouteDefinition();
            const errorMessage = 'Test error';
            const status = StatusCodes.INTERNAL_SERVER_ERROR;
            const handler = def.wrapHandler((req, res, error) => error(errorMessage, status));
            const mockResJSON = jest.fn();
            const mockNext = jest.fn();
            handler({}, {json: mockResJSON}, mockNext);
            expect(mockResJSON).not.toHaveBeenCalled();
            expect(mockNext).toHaveBeenCalledWith(new APIError(errorMessage, status));
        });
    });

    describe('getPageParam', () => {
        test('throws error for non-numeric page', () => {
            const def = new APIRouteDefinition();
            const req = {query: {page: 'foo'}};
            expect(() => def.getPageParam(req)).toThrow(APIError);
        });

        test('throws error for page zero', () => {
            const def = new APIRouteDefinition();
            const req = {query: {page: '0'}};
            expect(() => def.getPageParam(req)).toThrow(APIError);
        });

        test('throws error for negative page', () => {
            const def = new APIRouteDefinition();
            const req = {query: {page: '-1'}};
            expect(() => def.getPageParam(req)).toThrow(APIError);
        });

        test('returns integer for positive page', () => {
            const def = new APIRouteDefinition();
            const req = {query: {page: '42'}};
            expect(def.getPageParam(req)).toEqual(42);
        });

        test('defaults to page 1 if param missing', () => {
            const def = new APIRouteDefinition();
            const req = {query: {}};
            expect(def.getPageParam(req)).toEqual(1);
        });
    });

    describe('getPaginationResponse', () => {
        const ITEM_KEY = 'widgets';

        test('throws error for invalid page', async () => {
            const def = new APIRouteDefinition();
            const req = {query: {page: 'foo'}};
            await expect(async () => await def.getPaginationResponse(req, ITEM_KEY, null, null)).rejects.toThrow(APIError);
        });

        test('throws error if count fails', async () => {
            const count = jest.fn().mockRejectedValue(new Error('test error'));
            const def = new APIRouteDefinition();
            const req = {query: {page: '2'}};
            await expect(async () => await def.getPaginationResponse(req, ITEM_KEY, count, null)).rejects.toThrow(APIError);
        });

        test('throws error if page is too high', async () => {
            const count = jest.fn().mockResolvedValue(1);
            const def = new APIRouteDefinition();
            const req = {query: {page: '2'}};
            await expect(async () => await def.getPaginationResponse(req, ITEM_KEY, count, null)).rejects.toThrow(APIError);
        });

        test('throws error if getPaginatedList fails', async () => {
            const count = jest.fn().mockResolvedValue(1);
            const getPaginatedList = jest.fn().mockRejectedValue(new Error('test error'));
            const def = new APIRouteDefinition();
            const req = {query: {page: '2'}};
            await expect(async () => await def.getPaginationResponse(req, ITEM_KEY, count, getPaginatedList)).rejects.toThrow(APIError);
        });

        test('returns PaginationResponse with expected fields on success', async() => {
            const widgets = [{widgetID: 'widget', name: 'foo'}];
            const total = widgets.length;
            const page = 1;
            const count = jest.fn().mockResolvedValue(total);
            const getPaginatedList = jest.fn().mockResolvedValue(widgets);
            const def = new APIRouteDefinition();
            const req = {query: {page: `${page}`}};
            const response = await def.getPaginationResponse(req, ITEM_KEY, count, getPaginatedList);
            expect(response).toEqual(new PaginationResponse(false, total, page, widgets, ITEM_KEY));
        });
    });

    test('delete', () => {
        const def = new APIRouteDefinition();
        const path = '/test';
        expect(def._router.stack).toHaveLength(0);
        def.delete(path, (req, res, error) => res.json({test: true}));
        expect(def._router.stack).toHaveLength(1);
        const route = def._router.stack[0].route;
        expect(route.path).toEqual(path);
        expect(route.methods).toEqual({delete: true});
        expect(route.stack).toHaveLength(1);
        expect(route.stack[0].method).toEqual('delete');
    });

    test('get', () => {
        const def = new APIRouteDefinition();
        const path = '/test';
        expect(def._router.stack).toHaveLength(0);
        def.get(path, (req, res, error) => res.json({test: true}));
        expect(def._router.stack).toHaveLength(1);
        const route = def._router.stack[0].route;
        expect(route.path).toEqual(path);
        expect(route.methods).toEqual({get: true});
        expect(route.stack).toHaveLength(1);
        expect(route.stack[0].method).toEqual('get');
    });

    test('patch', () => {
        const def = new APIRouteDefinition();
        const path = '/test';
        expect(def._router.stack).toHaveLength(0);
        def.patch(path, (req, res, error) => res.json({test: true}));
        expect(def._router.stack).toHaveLength(1);
        const route = def._router.stack[0].route;
        expect(route.path).toEqual(path);
        expect(route.methods).toEqual({patch: true});
        expect(route.stack).toHaveLength(1);
        expect(route.stack[0].method).toEqual('patch');
    });

    test('post', () => {
        const def = new APIRouteDefinition();
        const path = '/test';
        expect(def._router.stack).toHaveLength(0);
        def.post(path, (req, res, error) => res.json({test: true}));
        expect(def._router.stack).toHaveLength(1);
        const route = def._router.stack[0].route;
        expect(route.path).toEqual(path);
        expect(route.methods).toEqual({post: true});
        expect(route.stack).toHaveLength(1);
        expect(route.stack[0].method).toEqual('post');
    });

    test('put', () => {
        const def = new APIRouteDefinition();
        const path = '/test';
        expect(def._router.stack).toHaveLength(0);
        def.put(path, (req, res, error) => res.json({test: true}));
        expect(def._router.stack).toHaveLength(1);
        const route = def._router.stack[0].route;
        expect(route.path).toEqual(path);
        expect(route.methods).toEqual({put: true});
        expect(route.stack).toHaveLength(1);
        expect(route.stack[0].method).toEqual('put');
    });
});
