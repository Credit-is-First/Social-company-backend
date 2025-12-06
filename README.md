# Library Management System - Backend

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create MySQL database:
```sql
CREATE DATABASE library_db;
```

3. Update database credentials in `src/app.module.ts` if needed.

4. Start the development server:
```bash
npm run start:dev
```

The API will be available at `http://localhost:3001`
Swagger documentation: `http://localhost:3001/api`

## API Endpoints

See Swagger documentation at `/api` for detailed API documentation.

### Books
- `GET /books` - Get all books
- `GET /books?search=query` - Search books
- `GET /books/:id` - Get book by ID
- `POST /books` - Create a new book
- `PATCH /books/:id` - Update a book
- `DELETE /books/:id` - Delete a book

### Users
- `GET /users` - Get all users
- `GET /users?search=query` - Search users
- `GET /users/:id` - Get user by ID
- `POST /users` - Create a new user
- `PATCH /users/:id` - Update a user
- `DELETE /users/:id` - Delete a user

### Loans
- `GET /loans` - Get all loans
- `GET /loans?userId=id` - Get loans by user
- `GET /loans?bookId=id` - Get loans by book
- `GET /loans/active` - Get active loans
- `GET /loans/:id` - Get loan by ID
- `POST /loans` - Create a new loan
- `PATCH /loans/:id` - Update a loan (e.g., return book)
- `DELETE /loans/:id` - Delete a loan

