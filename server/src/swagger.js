import swaggerJsdoc from 'swagger-jsdoc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'MyPortfolio API',
      version: '1.0.0',
      description: 'Locally hosted personal finance & net worth tracker API',
      contact: {
        name: 'MyPortfolio',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: 'http://127.0.0.1:3001/api/v1',
        description: 'Development server (v1)',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token obtained from /auth/login or /auth/setup',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'mp_rt',
          description: 'HttpOnly refresh token cookie (path: /api/v1/auth)',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Human-readable error message',
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Human-readable error message',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            username: { type: 'string', example: 'jane' },
            displayName: { type: 'string', example: 'Jane Doe' },
            role: { type: 'string', enum: ['admin', 'member'], example: 'admin' },
            themePref: { type: 'string', example: 'dark' },
          },
        },
        Account: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            name: { type: 'string', example: 'Chase Checking' },
            institution: { type: 'string', nullable: true, example: 'Chase' },
            categoryId: { type: 'integer', nullable: true, example: 1 },
            categoryName: { type: 'string', nullable: true, example: 'Cash' },
            kind: { type: 'string', nullable: true, example: 'checking' },
            isAsset: { type: 'boolean', example: true },
            notes: { type: 'string', nullable: true },
            archived: { type: 'boolean', example: false },
            cashBalance: { type: 'number', example: 1250.0 },
            cashUpdatedAt: { type: 'string', format: 'date', nullable: true, example: '2026-10-05' },
            createdAt: { type: 'string', format: 'date-time' },
            latestValue: { type: 'number', nullable: true, example: 5000.00 },
            latestDate: { type: 'string', format: 'date', nullable: true, example: '2025-01-15' },
          },
        },
        Category: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            name: { type: 'string', example: 'Cash' },
          },
        },
        Snapshot: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            value: { type: 'number', example: 5000.00 },
            asOfDate: { type: 'string', format: 'date', example: '2025-01-15' },
            note: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        NetWorthReport: {
          type: 'object',
          properties: {
            current: {
              type: 'object',
              properties: {
                assets: { type: 'number', example: 150000 },
                liabilities: { type: 'number', example: 50000 },
                netWorth: { type: 'number', example: 100000 },
                asOf: { type: 'string', format: 'date', nullable: true, example: '2025-01-15' },
              },
            },
            changes: {
              type: 'object',
              properties: {
                sincePrevSnapshot: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    delta: { type: 'number', example: 500 },
                    pct: { type: 'number', example: 0.5 },
                    since: { type: 'string', format: 'date', example: '2024-12-15' },
                  },
                },
                last30Days: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    delta: { type: 'number', example: 2000 },
                    pct: { type: 'number', example: 2.0 },
                    since: { type: 'string', format: 'date', example: '2024-12-16' },
                  },
                },
              },
            },
            series: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', format: 'date', example: '2025-01-15' },
                  assets: { type: 'number', example: 150000 },
                  liabilities: { type: 'number', example: 50000 },
                  netWorth: { type: 'number', example: 100000 },
                },
              },
            },
          },
        },
        AllocationReport: {
          type: 'object',
          properties: {
            assets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Investment' },
                  total: { type: 'number', example: 80000 },
                },
              },
            },
            liabilities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'Liability' },
                  total: { type: 'number', example: 50000 },
                },
              },
            },
          },
        },
        SetupStatus: {
          type: 'object',
          properties: {
            needsSetup: { type: 'boolean', example: true },
          },
        },
        UsersResponse: {
          type: 'object',
          properties: {
            users: {
              type: 'array',
              items: { $ref: '#/components/schemas/User' },
            },
          },
        },
        CreateUserRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: {
              type: 'string',
              pattern: '^[a-zA-Z0-9_.-]{3,32}$',
              example: 'bob',
            },
            password: {
              type: 'string',
              format: 'password',
              minLength: 8,
              example: 'secret123',
            },
            displayName: { type: 'string', example: 'Bob Smith' },
            role: { type: 'string', enum: ['admin', 'member'], example: 'member' },
          },
        },
        UpdateUserRequest: {
          type: 'object',
          properties: {
            displayName: { type: 'string', example: 'Bob Smith' },
            role: { type: 'string', enum: ['admin', 'member'] },
            password: {
              type: 'string',
              format: 'password',
              minLength: 8,
            },
            username: {
              type: 'string',
              pattern: '^[a-zA-Z0-9_.-]{3,32}$',
              example: 'bob',
            },
          },
        },
        AccountsResponse: {
          type: 'object',
          properties: {
            accounts: {
              type: 'array',
              items: { $ref: '#/components/schemas/Account' },
            },
          },
        },
        CategoriesResponse: {
          type: 'object',
          properties: {
            categories: {
              type: 'array',
              items: { $ref: '#/components/schemas/Category' },
            },
          },
        },
        SnapshotsResponse: {
          type: 'object',
          properties: {
            snapshots: {
              type: 'array',
              items: { $ref: '#/components/schemas/Snapshot' },
            },
            hasMore: {
              type: 'boolean',
              description: 'True when older snapshots exist beyond this page',
            },
            limit: { type: 'integer', example: 500 },
            offset: { type: 'integer', example: 0 },
          },
        },
        CreateAccountRequest: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', maxLength: 80, example: 'Chase Checking' },
            institution: { type: 'string', maxLength: 120, example: 'Chase' },
            categoryId: { type: 'integer', example: 1 },
            kind: { type: 'string', example: 'checking' },
            isAsset: { type: 'boolean', default: true, example: true },
            notes: { type: 'string', maxLength: 2000 },
            cashBalance: { type: 'number', minimum: 0, example: 1250.0 },
            cashUpdatedAt: { type: 'string', format: 'date', example: '2026-10-05' },
          },
        },
        UpdateAccountRequest: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 80, example: 'Chase Checking' },
            institution: {
              type: ['string', 'null'],
              maxLength: 120,
              example: 'Chase',
            },
            categoryId: { type: ['integer', 'null'], example: 1 },
            kind: { type: 'string', example: 'checking' },
            isAsset: { type: 'boolean', example: true },
            notes: { type: ['string', 'null'], maxLength: 2000 },
            archived: { type: 'boolean', example: false },
            cashBalance: { type: 'number', minimum: 0, example: 1250.0 },
            cashUpdatedAt: { type: ['string', 'null'], format: 'date', example: '2026-10-05' },
          },
        },
        CreateSnapshotRequest: {
          type: 'object',
          required: ['value', 'asOfDate'],
          properties: {
            value: { type: 'number', minimum: 0, example: 5000.00 },
            asOfDate: { type: 'string', format: 'date', example: '2025-01-15' },
            note: { type: 'string', maxLength: 500 },
          },
        },
        UpdateSnapshotRequest: {
          type: 'object',
          properties: {
            value: { type: 'number', minimum: 0, example: 5000.00 },
            asOfDate: { type: 'string', format: 'date', example: '2025-01-15' },
            note: { type: ['string', 'null'], maxLength: 500 },
          },
        },
        Holding: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            accountId: { type: 'integer', example: 1 },
            ticker: { type: 'string', example: 'VTI' },
            name: { type: 'string', nullable: true, example: 'Vanguard Total Stock Market' },
            shares: { type: 'number', example: 10.5 },
            costBasis: { type: 'number', example: 2200.0 },
            currency: { type: 'string', example: 'USD' },
            assetType: { type: 'string', nullable: true, enum: ['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'MUTUALFUND'], example: 'ETF' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        IncomeEvent: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            accountId: { type: 'integer', example: 1 },
            holdingId: { type: 'integer', nullable: true, example: 1 },
            type: { type: 'string', enum: ['dividend', 'interest', 'distribution', 'other'] },
            amount: { type: 'number', example: 42.5 },
            currency: { type: 'string', example: 'USD' },
            asOfDate: { type: 'string', format: 'date', example: '2025-01-15' },
            note: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ImportRequest: {
          type: 'object',
          required: ['format', 'content'],
          properties: {
            format: { type: 'string', enum: ['json', 'csv'] },
            content: {
              type: 'string',
              description: 'Raw file text to import',
            },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIs...' },
            user: { $ref: '#/components/schemas/User' },
          },
        },
        ImportResult: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: true },
            accountsCreated: { type: 'integer', example: 7 },
            snapshotsAdded: { type: 'integer', example: 672 },
            snapshotsSkipped: { type: 'integer', example: 0 },
            holdingsCreated: { type: 'integer', example: 4 },
            incomeAdded: { type: 'integer', example: 12 },
            incomeSkipped: { type: 'integer', example: 0 },
          },
        },
        ResetResult: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: true },
            deletedAccounts: { type: 'integer', example: 5 },
            deletedSnapshots: { type: 'integer', example: 60 },
            reseeded: { type: 'boolean', example: true },
          },
        },
        SetThemeRequest: {
          type: 'object',
          required: ['theme'],
          properties: {
            theme: { type: 'string', example: 'dark' },
          },
        },
        ThemesResponse: {
          type: 'object',
          properties: {
            themes: {
              type: 'array',
              items: { type: 'string' },
              example: ['light', 'dark', 'rosepine', 'everforest'],
            },
          },
        },
        Quote: {
          type: 'object',
          properties: {
            ticker: { type: 'string', example: 'VTI' },
            name: { type: 'string', nullable: true, example: 'Vanguard Total Stock Market ETF' },
            price: { type: 'number', example: 380.6 },
            currency: { type: 'string', example: 'USD' },
            asOf: { type: 'string', format: 'date', nullable: true, example: '2026-10-02' },
            source: { type: 'string', example: 'yahoo' },
            cached: { type: 'boolean', example: false },
            ok: { type: 'boolean', example: true },
          },
        },
        QuoteError: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Quote unavailable right now' },
          },
        },
        SearchResult: {
          type: 'object',
          properties: {
            symbol: { type: 'string', example: 'BTC-USD' },
            name: { type: 'string', nullable: true, example: 'Bitcoin USD' },
            type: { type: 'string', enum: ['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'MUTUALFUND'], example: 'CRYPTOCURRENCY' },
            typeLabel: { type: 'string', example: 'Cryptocurrency' },
            exchange: { type: 'string', nullable: true, example: 'CCC' },
          },
        },
        IntradayChart: {
          type: 'object',
          properties: {
            ticker: { type: 'string', example: 'AAPL' },
            name: { type: 'string', nullable: true, example: 'Apple Inc.' },
            currency: { type: 'string', example: 'USD' },
            previousClose: { type: 'number', nullable: true, example: 228.5 },
            current: { type: 'number', nullable: true, example: 231.2 },
            change: { type: 'number', nullable: true, example: 2.7 },
            changePercent: { type: 'number', nullable: true, example: 1.18 },
            points: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  t: { type: 'number', description: 'Epoch milliseconds', example: 1791211800000 },
                  close: { type: 'number', example: 231.2 },
                },
              },
            },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: true },
            name: { type: 'string', example: 'MyPortfolio API' },
            demo: { type: 'boolean', example: false },
            time: { type: 'string', format: 'date-time' },
          },
        },
        InvestmentHolding: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            accountId: { type: 'integer' },
            ticker: { type: 'string', example: 'VTI' },
            name: { type: 'string', nullable: true },
            shares: { type: 'number', example: 10 },
            costBasis: { type: 'number', example: 3000 },
            currency: { type: 'string', example: 'USD' },
            assetType: { type: 'string', nullable: true, example: 'ETF' },
            price: { type: 'number', nullable: true, example: 380.6 },
            marketValue: { type: 'number', nullable: true, example: 3806 },
            gain: { type: 'number', nullable: true, example: 806 },
            gainPct: { type: 'number', nullable: true, example: 26.87 },
          },
        },
        InvestmentsReport: {
          type: 'object',
          properties: {
            accounts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  name: { type: 'string' },
                  institution: { type: 'string', nullable: true },
                  kind: { type: 'string', nullable: true },
                  categoryName: { type: 'string' },
                  cashBalance: { type: 'number' },
                  holdings: { type: 'array', items: { $ref: '#/components/schemas/InvestmentHolding' } },
                },
              },
            },
            byHolding: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  ticker: { type: 'string' },
                  name: { type: 'string', nullable: true },
                  marketValue: { type: 'number' },
                  weight: { type: 'number', example: 12.4 },
                },
              },
            },
            totals: {
              type: 'object',
              properties: {
                costBasis: { type: 'number' },
                pricedCost: { type: 'number' },
                marketValue: { type: 'number' },
                gain: { type: 'number' },
                gainPct: { type: 'number', nullable: true },
                cash: { type: 'number' },
                priced: { type: 'integer' },
                positions: { type: 'integer' },
              },
            },
          },
        },
        IncomeReport: {
          type: 'object',
          properties: {
            range: {
              type: 'object',
              properties: {
                from: { type: 'string', format: 'date', nullable: true },
                to: { type: 'string', format: 'date', nullable: true },
              },
            },
            totals: {
              type: 'object',
              properties: {
                total: { type: 'number', example: 1250.5 },
                count: { type: 'integer', example: 14 },
                byType: {
                  type: 'object',
                  properties: {
                    dividend: { type: 'number' },
                    interest: { type: 'number' },
                    distribution: { type: 'number' },
                    other: { type: 'number' },
                  },
                },
              },
            },
            byAccount: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  accountId: { type: 'integer' },
                  name: { type: 'string' },
                  total: { type: 'number' },
                  count: { type: 'integer' },
                  byType: { type: 'object', additionalProperties: { type: 'number' } },
                },
              },
            },
            monthly: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  month: { type: 'string', example: '2026-03' },
                  amount: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: [
      { name: 'Authentication', description: 'Auth & session management' },
      { name: 'Users', description: 'Household user management (admin only)' },
      { name: 'Accounts', description: 'Financial accounts & balance snapshots' },
      { name: 'Market', description: 'Live ticker quotes (name + latest price)' },
      { name: 'Reports', description: 'Net worth & allocation reports' },
      { name: 'Settings', description: 'User preferences & data management' },
      { name: 'Export', description: 'Full data export (JSON/CSV)' },
      { name: 'Health', description: 'Health check endpoints' },
    ],
  },
  apis: [
    path.join(__dirname, 'routes', '*.js').replace(/\\/g, '/'),
    path.join(__dirname, 'app.js').replace(/\\/g, '/'),
    path.join(__dirname, 'index.js').replace(/\\/g, '/'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);