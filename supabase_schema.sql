-- 1. Create the expenses table
CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    date date NOT NULL,
    amount numeric(10,2) NOT NULL,
    provider text NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    notes text,
    year integer NOT NULL,
    receipt_url text,
    receipt_name text
);

-- 2. Enable Row Level Security (RLS) on the table
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- 3. Create policies for the table (for anon public access since auth relies on the simple 'PASSWORD' in frontend JS)
-- Note: Replace these with authenticated policies if you implement actual Supabase Auth instead of public key
CREATE POLICY "Enable read access for all users" ON public.expenses FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON public.expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable delete for all users" ON public.expenses FOR DELETE USING (true);
CREATE POLICY "Enable update for all users" ON public.expenses FOR UPDATE USING (true);

-- 4. Create the storage bucket for receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true);

-- 5. Create storage policies to allow anonymous uploads and reads (for simplicity based on your app's auth strategy)
CREATE POLICY "Public Receipt Access" ON storage.objects FOR SELECT USING (bucket_id = 'receipts');
CREATE POLICY "Public Receipt Uploads" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'receipts');
CREATE POLICY "Public Receipt Deletes" ON storage.objects FOR DELETE USING (bucket_id = 'receipts');
