-- Migration: Add parent_course_id to courses table for grouping multiple modules under one course

ALTER TABLE courses
  ADD COLUMN parent_course_id integer NULL;

-- Optional: add a foreign key constraint referencing the same table
ALTER TABLE courses
  ADD CONSTRAINT fk_parent_course
  FOREIGN KEY (parent_course_id) REFERENCES courses(id) ON DELETE SET NULL;
