-- Create scenario_assignments table for assigning roleplays to users or departments

CREATE TABLE IF NOT EXISTS public.scenario_assignments (
    assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id TEXT NOT NULL,
    assignment_type TEXT NOT NULL CHECK (assignment_type IN ('department', 'sub_department', 'user')),
    target_id UUID NOT NULL,
    company_id UUID NOT NULL,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Foreign key to scenarios table
    CONSTRAINT fk_scenario FOREIGN KEY (scenario_id) REFERENCES public.scenarios(scenario_id) ON DELETE CASCADE,
    
    -- Foreign key to companies table
    CONSTRAINT fk_company FOREIGN KEY (company_id) REFERENCES public.companies(company_id) ON DELETE CASCADE,
    
    -- Unique constraint to prevent duplicate assignments
    CONSTRAINT unique_assignment UNIQUE (scenario_id, assignment_type, target_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_scenario_assignments_scenario_id ON public.scenario_assignments(scenario_id);
CREATE INDEX IF NOT EXISTS idx_scenario_assignments_target_id ON public.scenario_assignments(target_id);
CREATE INDEX IF NOT EXISTS idx_scenario_assignments_company_id ON public.scenario_assignments(company_id);
CREATE INDEX IF NOT EXISTS idx_scenario_assignments_assignment_type ON public.scenario_assignments(assignment_type);

-- Enable Row Level Security
ALTER TABLE public.scenario_assignments ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to view assignments for their company
CREATE POLICY "Users can view assignments for their company" ON public.scenario_assignments
    FOR SELECT
    USING (
        company_id IN (
            SELECT company_id FROM public.users WHERE user_id = auth.uid()
        )
    );

-- Create policy to allow admins to insert/update/delete assignments for their company
CREATE POLICY "Admins can manage assignments for their company" ON public.scenario_assignments
    FOR ALL
    USING (
        company_id IN (
            SELECT company_id FROM public.users WHERE user_id = auth.uid()
        )
    );

-- Add comment
COMMENT ON TABLE public.scenario_assignments IS 'Stores roleplay scenario assignments to departments or individual users. Departments are from sub_department table (where sub_department_name IS NULL).';

-- Notes:
-- 1. target_id can reference:
--    - user_id from users table (when assignment_type = 'user')
--    - department_id from sub_department table (when assignment_type = 'department' or 'sub_department')
-- 2. The sub_department table contains both departments (where sub_department_name IS NULL) 
--    and sub-departments (where sub_department_name IS NOT NULL)
-- 3. Users are linked to departments via department_id in users table
