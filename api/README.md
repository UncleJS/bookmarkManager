# Bookmark Manager API

A Node.js Express API that provides endpoints for managing bookmarks, tags, and classifications. Built with MariaDB for data persistence.

## Architecture Overview

The API follows a clean architecture pattern with the following layers:
- **Routes**: Handle HTTP requests and responses
- **Database**: MariaDB with connection pooling
- **Middleware**: Error handling and logging
- **Migrations**: Database schema management

## Database Schema

### Core Tables

1. **bookmarks** - Main bookmark storage
   - `url` (TEXT): The bookmarked URL
   - `title` (VARCHAR): Page title
   - `description` (TEXT): Optional description
   - `favicon_url` (TEXT): Favicon URL
   - Boolean flags: `read_later`, `hot_topic`, `cheatsheets`, `archived`, `for_review`

2. **classification_groups** - Hierarchical grouping of classifications
   - Used to organize classifications into logical groups (e.g., "Development", "Personal")

3. **classifications** - Categorization system
   - Belongs to a classification group
   - Many-to-many relationship with bookmarks

4. **tags** - Flexible tagging system
   - Many-to-many relationship with bookmarks
   - Supports autocomplete and search

### Junction Tables
- **bookmark_tags** - Links bookmarks to tags
- **bookmark_classifications** - Links bookmarks to classifications

## API Endpoints

### Health Check
- `GET /health` - Returns API status and database connectivity

### Classifications
- `GET /classifications` - Get all classifications grouped by category
- `POST /classifications` - Create new classification

### Tags  
- `GET /tags` - Get all tags with optional search/autocomplete
- `POST /tags` - Create new tag

### Bookmarks
- `POST /bookmarks` - Create new bookmark with tags and classifications

## Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Database Configuration
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=bookmark_user
DB_PASSWORD=bookmark_pass
DB_NAME=bookmark_manager

# API Configuration
API_PORT=3000
NODE_ENV=development
```

## Development Setup

1. Start the database:
```bash
docker compose up -d
```

2. Install dependencies:
```bash
npm install
```

3. Run migrations:
```bash
npm run migrate
```

4. Start the development server:
```bash
npm run dev
```

## Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with file watching
- `npm run migrate` - Run database migrations
- `npm run smoke` - Run basic health check tests

## Error Handling

The API uses structured error handling with:
- HTTP status codes
- Consistent error response format
- Request logging with Pino
- Database transaction rollback on errors

## Performance Considerations

- Connection pooling for database efficiency
- Prepared statements to prevent SQL injection
- Indexed foreign keys for fast joins
- Transaction management for data consistency
