import type { Role } from "@/lib/constants";
import { findCity } from "@/lib/geo/india";
import { jitter, type LatLng } from "./globe-math";

/**
 * SAMPLE profiles for the landing page. They are illustrations, not real people, and the page says so. Names are fictional
 * and already in the masked form real profiles use. They are spread across the country on purpose: DevMap is for all of India.
 */
export type DemoPerson = { id: string; name: string; role: Role; city: string; at: LatLng; skill: string; rate: number; online: boolean };

const city = (n: string): LatLng => {
  const c = findCity(n);
  if (!c) throw new Error(`demo city "${n}" is not in the city list`);
  return [c.lat, c.lng];
};
const place = (base: LatLng, seed: number): LatLng => {
  const [a, b] = jitter(seed);
  return [base[0] + a, base[1] + b];
};

const SAMPLE: [string, Role, string, string, number, boolean][] = [
  ["Rahul S.", "developer", "Bengaluru", "Flutter & Kotlin", 600, true],
  ["Priya N.", "developer", "Kochi", "React & Next.js", 800, true],
  ["Aditi M.", "designer", "Ahmedabad", "Mobile app design", 650, true],
  ["Pallavi R.", "marketer", "Bengaluru", "Meta ads in Kannada", 600, true],
  ["Karthik I.", "developer", "Chennai", "Swift & Flutter", 700, false],
  ["Rohit D.", "developer", "Pune", "Python & Go", 500, false],
  ["Meera J.", "designer", "Mumbai", "Design systems", 550, true],
  ["Arnab S.", "developer", "Kolkata", "Java & Kotlin", 450, true],
  ["Tanmoy D.", "marketer", "Kolkata", "SEO & Google Ads", 450, true],
  ["Rupa M.", "designer", "Delhi", "Figma & UI kits", 900, true],
  ["Nandini R.", "developer", "Hyderabad", "Vue & React", 350, false],
  ["Vikram S.", "marketer", "Jaipur", "Performance marketing", 500, true],
  ["Jyoti P.", "marketer", "Pune", "Marathi copywriting", 350, false],
  ["Dhruv K.", "developer", "Gurugram", "Node.js & Python", 550, true],
  ["Anita D.", "designer", "Guwahati", "Mobile app design", 650, true],
  ["Arup D.", "developer", "Silchar", "Java & Kotlin", 450, true],
  ["Sneha R.", "developer", "Bhubaneswar", "Django & React", 700, true],
  ["Imran Q.", "designer", "Lucknow", "UX research", 900, false],
  ["Kavya P.", "marketer", "Coimbatore", "SEO & content", 650, true],
  ["Harsh T.", "developer", "Indore", "Web & cloud", 500, true],
  ["Gurpreet S.", "developer", "Chandigarh", "Backend & DevOps", 1100, true],
  ["Manish K.", "marketer", "Patna", "Hindi video ads", 400, false],
  ["Bhavna P.", "designer", "Surat", "Brand & packaging", 600, true],
  ["Lakshmi V.", "developer", "Thiruvananthapuram", "Mobile & Android", 800, true],
];

export const DEMO_PEOPLE: DemoPerson[] = SAMPLE.map(([name, role, c, skill, rate, online], i): DemoPerson => ({
  id: `p${i}`, name, role, city: c, at: place(city(c), i + 1), skill, rate, online,
}));

/** Arcs drawn from one hub to the others, to make the globe feel like a living network. */
export const HUB: LatLng = city("Delhi");
export const ARC_TARGETS: LatLng[] = ["Guwahati", "Kolkata", "Mumbai", "Bengaluru", "Chennai", "Hyderabad"].map(city);

/** Home view: the whole of India, slightly tilted so both the Himalaya and the southern tip show. */
export const INDIA_VIEW = { lat: 23.5, lng: 82 };

/**
 * The "India only" view used after a visitor allows location: centred on the country and zoomed until it fills the round window.
 * (scale 1 = the whole globe fits; India spans ~30 degrees, so ~3.7 fills the frame with a margin.)
 */
export const INDIA_FIT = { lat: 22.6, lng: 80.8, scale: 3.7 };
