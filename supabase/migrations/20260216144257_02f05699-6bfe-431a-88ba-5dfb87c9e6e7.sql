
-- 1. Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'teacher', 'student');

-- 2. Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. User roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 5. Get user role function
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- 6. Classes table
CREATE TABLE public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  schedule TEXT,
  location TEXT,
  teacher_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

-- 7. Students table
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  class_id UUID REFERENCES public.classes(id),
  auth_user_id UUID UNIQUE REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- 8. Scores table
CREATE TABLE public.scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id),
  assignment_name TEXT NOT NULL,
  round INT NOT NULL,
  written_date DATE DEFAULT now(),
  reading INT,
  content_understanding INT,
  problem_understanding INT,
  composition INT,
  format INT,
  total_score INT,
  grade TEXT,
  feedback TEXT,
  pdf_path TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

-- 9. Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 10. RLS: profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- 11. RLS: user_roles
CREATE POLICY "Users can view own role"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- 12. RLS: classes
CREATE POLICY "Admins full access to classes"
  ON public.classes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers can view own classes"
  ON public.classes FOR SELECT
  USING (public.has_role(auth.uid(), 'teacher') AND teacher_id = auth.uid());

CREATE POLICY "Students can view own class"
  ON public.classes FOR SELECT
  USING (
    public.has_role(auth.uid(), 'student') AND
    id IN (SELECT class_id FROM public.students WHERE auth_user_id = auth.uid())
  );

-- 13. RLS: students
CREATE POLICY "Admins full access to students"
  ON public.students FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers can view students in their class"
  ON public.students FOR SELECT
  USING (
    public.has_role(auth.uid(), 'teacher') AND
    class_id IN (SELECT id FROM public.classes WHERE teacher_id = auth.uid())
  );

CREATE POLICY "Students can view own record"
  ON public.students FOR SELECT
  USING (public.has_role(auth.uid(), 'student') AND auth_user_id = auth.uid());

-- 14. RLS: scores
CREATE POLICY "Admins full access to scores"
  ON public.scores FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers can manage scores in their class"
  ON public.scores FOR ALL
  USING (
    public.has_role(auth.uid(), 'teacher') AND
    class_id IN (SELECT id FROM public.classes WHERE teacher_id = auth.uid())
  );

CREATE POLICY "Students can view own scores"
  ON public.scores FOR SELECT
  USING (
    public.has_role(auth.uid(), 'student') AND
    student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
  );

-- 15. Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', false);

-- 16. Storage RLS
CREATE POLICY "Admins can manage all attachments"
  ON storage.objects FOR ALL
  USING (bucket_id = 'attachments' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Teachers can upload attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'attachments' AND
    public.has_role(auth.uid(), 'teacher')
  );

CREATE POLICY "Teachers can view attachments in their classes"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attachments' AND
    public.has_role(auth.uid(), 'teacher')
  );

CREATE POLICY "Students can view own attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attachments' AND
    public.has_role(auth.uid(), 'student') AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.students WHERE auth_user_id = auth.uid()
    )
  );
