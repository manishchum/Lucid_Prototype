"""
Quick script to test permission checking logic
"""
import asyncio
from utils.db_operations import check_user_permission, check_company_access

async def main():
    user_id = 'ca356a93-4a24-41da-85d1-3dcf9de8f714'
    company_id = 'bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d'
    
    print(f"\n=== Testing Permissions for user {user_id} ===\n")
    
    # Test permission check
    has_manager = await check_user_permission(user_id, 'manager')
    print(f"\nHas manager permission: {has_manager}")
    
    # Test company access
    has_company = await check_company_access(user_id, company_id)
    print(f"\nHas company access: {has_company}")
    
    print(f"\n=== Both checks passed: {has_manager and has_company} ===\n")

if __name__ == "__main__":
    asyncio.run(main())
