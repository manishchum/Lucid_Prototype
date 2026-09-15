# Project Customizations and Guidelines

1. **Environment Variables**: Do not read or write permissions for .env files.
2. **Architecture**: We are developing an enterprise-grade project. Ensure everything is scalable and follows enterprise best practices.
3. **Frontend Components**: For each frontend component, try to keep everything in a single file (e.g., signup/page.tsx) instead of splitting it across multiple files unnecessarily.
4. **Database Queries**: Avoid using SELECT * commands. Instead, explicitly mention the specific column names in queries.
5. **Supabase Restrictions**: Do not call Supabase directly from the frontend. All database calls must be routed through the backend.
6. **Backend Structure**: For database functions, maintain a separate db folder in the backend that contains dedicated files for interacting with tables.
7. **Frontend Structure**: For new frontend features, organize .tsx files in dedicated feature directories (e.g., app/featurename/) instead of placing everything directly in app/ or crowding existing folders like app/signup/
8. **Styling**: Use existing CSS for all styling. Avoid using inline styles (style={{...}}) or creating custom .css files unless absolutely necessary for complex animations.
9. **API Integration**: When integrating with APIs, ensure that the requests are made through the backend (api-routes) and not directly from the frontend.
10. **Architecture**: Use the existing directory structure of the project in frontend and backend, as much as you can. Do not create unnecessary files and folders.
