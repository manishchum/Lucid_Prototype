add column company id - already added in subdepartment table

UPDATE public.sub_department sd
SET company_id = u.company_id
FROM (
    SELECT DISTINCT department_id, company_id
    FROM public.users
    WHERE department_id IS NOT NULL
) u
WHERE sd.department_id = u.department_id;


insert function
INSERT INTO public.function (function_name, company_id)
SELECT DISTINCT
    sd.department_name,
    u.company_id
FROM public.users u
JOIN public.sub_department sd
    ON u.department_id = sd.department_id
WHERE u.department_id IS NOT NULL;





insert subfunction

INSERT INTO public.sub_function (sub_function_name, function_id)
SELECT DISTINCT
    sd.sub_department_name,
    f.function_id
FROM public.users u
JOIN public.sub_department sd
    ON u.department_id = sd.department_id
JOIN public.function f
    ON f.function_name = sd.department_name
   AND f.company_id = u.company_id;




populate function and subfunction in uses table


UPDATE public.users u
SET
    function_id = f.function_id,
    sub_function_id = sf.sub_function_id
FROM public.sub_department sd,
     public.function f,
     public.sub_function sf
WHERE u.department_id = sd.department_id
  AND f.function_name = sd.department_name
  AND f.company_id = u.company_id
  AND sf.function_id = f.function_id
  AND sf.sub_function_name = sd.sub_department_name;


role play - scenario assignment table

ALTER TABLE public.scenario_assignments
DROP CONSTRAINT IF EXISTS scenario_assignments_department_id_fkey;

-- Drop the old check constraint for assignment_type
ALTER TABLE public.scenario_assignments
DROP CONSTRAINT IF EXISTS scenario_assignments_assignment_type_check;

ALTER TABLE scenario_assignments RENAME COLUMN department_id TO target_id;


companies table me is_Company_active
ALTER TABLE companies
ADD COLUMN is_company_active BOOLEAN NOT NULL DEFAULT true;






