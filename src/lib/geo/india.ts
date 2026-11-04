/**
 * Every state and union territory, and ~120 cities across them. A city is stored as an approximate CENTRE, never a
 * street address (PRD §0.2-G): it only places a cluster pin on the map and anchors the "nearby" search.
 *
 * City names are unique across the list, so a city alone identifies its state (`?city=Surat` is enough in a URL).
 * Adding a city is one line below; nothing else needs to change.
 */
export type City = { name: string; state: string; lat: number; lng: number };

const c = (state: string, name: string, lat: number, lng: number): City => ({ name, state, lat, lng });

export const CITIES: City[] = [
  c("Andhra Pradesh", "Visakhapatnam", 17.6868, 83.2185),
  c("Andhra Pradesh", "Vijayawada", 16.5062, 80.648),
  c("Andhra Pradesh", "Tirupati", 13.6288, 79.4192),
  c("Andhra Pradesh", "Guntur", 16.3067, 80.4365),
  c("Arunachal Pradesh", "Itanagar", 27.0844, 93.6053),
  c("Assam", "Guwahati", 26.1445, 91.7362),
  c("Assam", "Dibrugarh", 27.4728, 94.912),
  c("Assam", "Silchar", 24.8333, 92.7789),
  c("Assam", "Jorhat", 26.7509, 94.2037),
  c("Assam", "Tezpur", 26.6528, 92.7926),
  c("Assam", "Nagaon", 26.35, 92.6833),
  c("Assam", "Tinsukia", 27.4922, 95.3468),
  c("Assam", "Bongaigaon", 26.476, 90.56),
  c("Bihar", "Patna", 25.5941, 85.1376),
  c("Bihar", "Gaya", 24.7914, 85.0002),
  c("Bihar", "Bhagalpur", 25.2425, 86.9842),
  c("Bihar", "Muzaffarpur", 26.1209, 85.3647),
  c("Chhattisgarh", "Raipur", 21.2514, 81.6296),
  c("Chhattisgarh", "Bhilai", 21.1938, 81.3509),
  c("Chhattisgarh", "Bilaspur", 22.0797, 82.1409),
  c("Goa", "Panaji", 15.4909, 73.8278),
  c("Goa", "Margao", 15.2993, 73.958),
  c("Gujarat", "Ahmedabad", 23.0225, 72.5714),
  c("Gujarat", "Surat", 21.1702, 72.8311),
  c("Gujarat", "Vadodara", 22.3072, 73.1812),
  c("Gujarat", "Rajkot", 22.3039, 70.8022),
  c("Gujarat", "Gandhinagar", 23.2156, 72.6369),
  c("Haryana", "Gurugram", 28.4595, 77.0266),
  c("Haryana", "Faridabad", 28.4089, 77.3178),
  c("Haryana", "Panipat", 29.3909, 76.9635),
  c("Haryana", "Ambala", 30.3782, 76.7767),
  c("Himachal Pradesh", "Shimla", 31.1048, 77.1734),
  c("Himachal Pradesh", "Dharamshala", 32.219, 76.3234),
  c("Jharkhand", "Ranchi", 23.3441, 85.3096),
  c("Jharkhand", "Jamshedpur", 22.8046, 86.2029),
  c("Jharkhand", "Dhanbad", 23.7957, 86.4304),
  c("Karnataka", "Bengaluru", 12.9716, 77.5946),
  c("Karnataka", "Mysuru", 12.2958, 76.6394),
  c("Karnataka", "Mangaluru", 12.9141, 74.856),
  c("Karnataka", "Hubballi", 15.3647, 75.124),
  c("Karnataka", "Belagavi", 15.8497, 74.4977),
  c("Kerala", "Kochi", 9.9312, 76.2673),
  c("Kerala", "Thiruvananthapuram", 8.5241, 76.9366),
  c("Kerala", "Kozhikode", 11.2588, 75.7804),
  c("Kerala", "Thrissur", 10.5276, 76.2144),
  c("Madhya Pradesh", "Bhopal", 23.2599, 77.4126),
  c("Madhya Pradesh", "Indore", 22.7196, 75.8577),
  c("Madhya Pradesh", "Gwalior", 26.2183, 78.1828),
  c("Madhya Pradesh", "Jabalpur", 23.1815, 79.9864),
  c("Maharashtra", "Mumbai", 19.076, 72.8777),
  c("Maharashtra", "Pune", 18.5204, 73.8567),
  c("Maharashtra", "Nagpur", 21.1458, 79.0882),
  c("Maharashtra", "Nashik", 19.9975, 73.7898),
  c("Maharashtra", "Thane", 19.2183, 72.9781),
  c("Maharashtra", "Chhatrapati Sambhajinagar", 19.8762, 75.3433),
  c("Maharashtra", "Kolhapur", 16.705, 74.2433),
  c("Manipur", "Imphal", 24.817, 93.9368),
  c("Meghalaya", "Shillong", 25.5788, 91.8933),
  c("Mizoram", "Aizawl", 23.7271, 92.7176),
  c("Nagaland", "Kohima", 25.6747, 94.1086),
  c("Nagaland", "Dimapur", 25.9042, 93.7266),
  c("Odisha", "Bhubaneswar", 20.2961, 85.8245),
  c("Odisha", "Cuttack", 20.4625, 85.883),
  c("Odisha", "Rourkela", 22.2604, 84.8536),
  c("Punjab", "Ludhiana", 30.901, 75.8573),
  c("Punjab", "Amritsar", 31.634, 74.8723),
  c("Punjab", "Jalandhar", 31.326, 75.5762),
  c("Punjab", "Mohali", 30.7046, 76.7179),
  c("Rajasthan", "Jaipur", 26.9124, 75.7873),
  c("Rajasthan", "Jodhpur", 26.2389, 73.0243),
  c("Rajasthan", "Udaipur", 24.5854, 73.7125),
  c("Rajasthan", "Kota", 25.2138, 75.8648),
  c("Sikkim", "Gangtok", 27.3389, 88.6065),
  c("Tamil Nadu", "Chennai", 13.0827, 80.2707),
  c("Tamil Nadu", "Coimbatore", 11.0168, 76.9558),
  c("Tamil Nadu", "Madurai", 9.9252, 78.1198),
  c("Tamil Nadu", "Tiruchirappalli", 10.7905, 78.7047),
  c("Telangana", "Hyderabad", 17.385, 78.4867),
  c("Telangana", "Warangal", 17.9689, 79.5941),
  c("Tripura", "Agartala", 23.8315, 91.2868),
  c("Uttar Pradesh", "Lucknow", 26.8467, 80.9462),
  c("Uttar Pradesh", "Noida", 28.5355, 77.391),
  c("Uttar Pradesh", "Kanpur", 26.4499, 80.3319),
  c("Uttar Pradesh", "Varanasi", 25.3176, 82.9739),
  c("Uttar Pradesh", "Agra", 27.1767, 78.0081),
  c("Uttar Pradesh", "Prayagraj", 25.4358, 81.8463),
  c("Uttar Pradesh", "Ghaziabad", 28.6692, 77.4538),
  c("Uttarakhand", "Dehradun", 30.3165, 78.0322),
  c("Uttarakhand", "Haridwar", 29.9457, 78.1642),
  c("West Bengal", "Kolkata", 22.5726, 88.3639),
  c("West Bengal", "Siliguri", 26.7271, 88.3953),
  c("West Bengal", "Durgapur", 23.5204, 87.3119),
  c("West Bengal", "Howrah", 22.5958, 88.2636),
  // Union territories
  c("Andaman and Nicobar Islands", "Port Blair", 11.6234, 92.7265),
  c("Chandigarh", "Chandigarh", 30.7333, 76.7794),
  c("Dadra and Nagar Haveli and Daman and Diu", "Daman", 20.3974, 72.8328),
  c("Delhi", "Delhi", 28.6139, 77.209),
  c("Jammu and Kashmir", "Srinagar", 34.0837, 74.7973),
  c("Jammu and Kashmir", "Jammu", 32.7266, 74.857),
  c("Ladakh", "Leh", 34.1526, 77.5771),
  c("Lakshadweep", "Kavaratti", 10.5667, 72.6417),
  c("Puducherry", "Puducherry", 11.9416, 79.8083),
];

/** All 28 states and 8 union territories, alphabetically. Derived from the cities, so the two can never disagree. */
export const STATES: string[] = [...new Set(CITIES.map((x) => x.state))].sort((a, b) => a.localeCompare(b));

export function findCity(name: string | undefined | null): City | undefined {
  return name ? CITIES.find((x) => x.name === name) : undefined;
}

export function citiesOf(state: string | undefined | null): City[] {
  return CITIES.filter((x) => x.state === state);
}

export function isState(name: string | undefined | null): name is string {
  return !!name && STATES.includes(name);
}
