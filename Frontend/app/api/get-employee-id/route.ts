import { NextRequest, NextResponse } from "next/server"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const fetchUserByEmail = async (email: string) => {
  const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
  if (!res.ok) return null;
  const payload = await res.json();
  return payload.user || payload; 
  let u = payload?.user || payload;
  if (Array.isArray(u)) u = u[0]; 
  return u || null;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const email = searchParams.get("email")
  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 })
  }
  const employeeData = await fetchUserByEmail(email);
  return NextResponse.json({ user_id: data?.user_id || null, employee: employeeData })
}
