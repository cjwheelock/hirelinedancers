export const site = {
  name: "Hire Line Dancers",
  url: "https://hirelinedancers.com",
  email: "hello@hirelinedancers.com",
  description:
    "Hire a line dance instructor and get every guest on their feet. Beginner-friendly, no rhythm required — perfect for weddings, corporate events, and private parties. Find a vetted instructor near you."
};

export const eventTypes = [
  {
    slug: "weddings",
    label: "Weddings",
    title: "Wedding Line Dance Instructors",
    intro:
      "Give guests a low-pressure way to fill the dance floor with a guided line dance lesson between dinner, speeches, and open dancing.",
    searches: ["wedding line dance instructor", "country wedding entertainment", "group dance for wedding"]
  },
  {
    slug: "corporate-events",
    label: "Corporate events",
    title: "Corporate Line Dancing",
    intro:
      "Book a polished group activity for offsites, conferences, holiday parties, retreats, and team-building programs.",
    searches: ["corporate line dancing", "team building dance instructor", "corporate event entertainment"]
  },
  {
    slug: "bachelorette-parties",
    label: "Bachelorette parties",
    title: "Bachelorette Line Dancing",
    intro:
      "Plan a fun, themed private lesson that works for mixed experience levels and gives the group something memorable to do together.",
    searches: ["bachelorette line dancing", "private line dance class", "country party activity"]
  },
  {
    slug: "private-parties",
    label: "Private parties",
    title: "Private Party Line Dance Instructors",
    intro:
      "Bring a beginner-friendly instructor to birthdays, reunions, backyard parties, and milestone celebrations.",
    searches: ["private line dance class", "dance instructor for party", "group dance entertainment"]
  },
  {
    slug: "venues",
    label: "Venues and bars",
    title: "Line Dance Instructors for Venues",
    intro:
      "Find instructors for country nights, recurring programming, brewery events, bars, and public dance nights.",
    searches: ["line dance instructor for country night", "teach line dancing at bar", "venue dance instructor"]
  },
  {
    slug: "schools-community",
    label: "Schools and community",
    title: "School and Community Line Dancing",
    intro:
      "Book a safe, participatory activity for schools, colleges, camps, senior centers, and community organizations.",
    searches: ["line dancing school event", "group dance instructor near me", "community dance instructor"]
  }
];

export const cities = [
  ["nashville-tn", "Nashville", "TN"],
  ["austin-tx", "Austin", "TX"],
  ["dallas-tx", "Dallas", "TX"],
  ["fort-worth-tx", "Fort Worth", "TX"],
  ["houston-tx", "Houston", "TX"],
  ["san-antonio-tx", "San Antonio", "TX"],
  ["phoenix-az", "Phoenix", "AZ"],
  ["denver-co", "Denver", "CO"],
  ["atlanta-ga", "Atlanta", "GA"],
  ["charlotte-nc", "Charlotte", "NC"],
  ["raleigh-nc", "Raleigh", "NC"],
  ["orlando-fl", "Orlando", "FL"],
  ["tampa-fl", "Tampa", "FL"],
  ["los-angeles-ca", "Los Angeles", "CA"],
  ["san-diego-ca", "San Diego", "CA"],
  ["san-francisco-ca", "San Francisco", "CA"],
  ["sacramento-ca", "Sacramento", "CA"],
  ["las-vegas-nv", "Las Vegas", "NV"],
  ["chicago-il", "Chicago", "IL"],
  ["kansas-city-mo", "Kansas City", "MO"],
  ["st-louis-mo", "St. Louis", "MO"],
  ["salt-lake-city-ut", "Salt Lake City", "UT"],
  ["boise-id", "Boise", "ID"],
  ["seattle-wa", "Seattle", "WA"],
  ["portland-or", "Portland", "OR"]
].map(([slug, city, state]) => ({ slug, city, state }));

// Top 10 line dancing cities — featured on the home page, each with a launch blog post.
export const topCities: { slug: string; blurb: string }[] = [
  { slug: "nashville-tn", blurb: "The line dance capital — honky-tonks on every block and the most requested city for wedding lessons." },
  { slug: "fort-worth-tx", blurb: "Home of Billy Bob's, the world's largest honky-tonk, and a stockyards party scene built on boots." },
  { slug: "austin-tx", blurb: "Two-step town with a booming bachelorette and corporate offsite market." },
  { slug: "dallas-tx", blurb: "Big rooms, big corporate events, and a deep bench of country and soul line dance talent." },
  { slug: "houston-tx", blurb: "Rodeo city energy with one of the largest event markets in the country." },
  { slug: "denver-co", blurb: "The Grizzly Rose put Denver on the map — mountain weddings keep it there." },
  { slug: "phoenix-az", blurb: "Western-theme events year-round, from Scottsdale resorts to desert weddings." },
  { slug: "atlanta-ga", blurb: "A powerhouse soul line dancing scene and a huge corporate and community event market." },
  { slug: "charlotte-nc", blurb: "A fast-growing city where country nights and company parties both pack the floor." },
  { slug: "las-vegas-nv", blurb: "The convention and destination-wedding capital — group entertainment is the whole point." }
];

export type Instructor = {
  slug: string;
  name: string;
  business: string;
  photo?: string;
  city: string;
  state: string;
  zip: string;
  travelRadius: number;
  years: number;
  startingRate: number;
  minHours: number;
  groupSize: number;
  founding: boolean;
  featured: boolean;
  rating: number;
  reviews: number;
  styles: string[];
  events: string[];
  tags: string[];
  bio: string;
  sampleFormat: string[];
};

export const instructors: Instructor[] = [
  {
    slug: "avery-cole-nashville-tn",
    name: "Avery Cole",
    business: "Music City Line Dance Co.",
    city: "Nashville",
    state: "TN",
    zip: "37203",
    travelRadius: 90,
    years: 9,
    startingRate: 450,
    minHours: 2,
    groupSize: 250,
    founding: true,
    featured: true,
    rating: 4.9,
    reviews: 38,
    styles: ["Country", "Beginner-friendly", "Wedding reception"],
    events: ["weddings", "corporate-events", "private-parties", "venues"],
    tags: ["Best for mixed-age groups", "Provides sound", "Custom choreography"],
    bio:
      "Avery teaches high-energy, beginner-first line dance experiences for receptions, corporate parties, and country nights across Middle Tennessee.",
    sampleFormat: ["15-minute warmup", "Two crowd-pleaser dances", "Photo-ready group finale"]
  },
  {
    slug: "morgan-rivera-austin-tx",
    name: "Morgan Rivera",
    business: "Austin Boot Step",
    city: "Austin",
    state: "TX",
    zip: "78701",
    travelRadius: 75,
    years: 7,
    startingRate: 395,
    minHours: 2,
    groupSize: 180,
    founding: true,
    featured: true,
    rating: 4.8,
    reviews: 29,
    styles: ["Country", "Pop line dances", "Corporate"],
    events: ["corporate-events", "bachelorette-parties", "venues", "private-parties"],
    tags: ["Corporate friendly", "DJ compatible", "Travels to Hill Country"],
    bio:
      "Morgan blends Austin event polish with an easy teaching style that gets cautious guests moving quickly.",
    sampleFormat: ["Event host intro", "Beginner step breakdown", "Three-dance party set"]
  },
  {
    slug: "jordan-wells-dallas-tx",
    name: "Jordan Wells",
    business: "Dallas Social Line Dance",
    city: "Dallas",
    state: "TX",
    zip: "75201",
    travelRadius: 65,
    years: 11,
    startingRate: 500,
    minHours: 2,
    groupSize: 300,
    founding: false,
    featured: true,
    rating: 5,
    reviews: 44,
    styles: ["Country", "Soul line dance", "Large groups"],
    events: ["corporate-events", "schools-community", "weddings", "venues"],
    tags: ["Large groups", "School/community friendly", "Insured"],
    bio:
      "Jordan leads polished lessons for large rooms, from company celebrations to school events and venue programming.",
    sampleFormat: ["Room reset", "Call-and-response teaching", "Optional team dance-off"]
  },
  {
    slug: "sierra-blake-denver-co",
    name: "Sierra Blake",
    business: "Front Range Line Dance",
    city: "Denver",
    state: "CO",
    zip: "80202",
    travelRadius: 80,
    years: 6,
    startingRate: 425,
    minHours: 2,
    groupSize: 160,
    founding: true,
    featured: false,
    rating: 4.7,
    reviews: 21,
    styles: ["Country", "Beginner workshop", "Private lessons"],
    events: ["private-parties", "bachelorette-parties", "corporate-events"],
    tags: ["Mountain venues", "Beginner friendly", "Private groups"],
    bio:
      "Sierra specializes in private-party lessons and destination events across Denver, Boulder, and mountain venues.",
    sampleFormat: ["Guest arrival lesson", "Easy two-wall dance", "Open-floor coaching"]
  },
  {
    slug: "camille-price-atlanta-ga",
    name: "Camille Price",
    business: "Peachtree Line Dance Collective",
    city: "Atlanta",
    state: "GA",
    zip: "30303",
    travelRadius: 70,
    years: 12,
    startingRate: 475,
    minHours: 2,
    groupSize: 225,
    founding: false,
    featured: false,
    rating: 4.9,
    reviews: 33,
    styles: ["Soul line dance", "Country fusion", "Community events"],
    events: ["schools-community", "corporate-events", "private-parties", "weddings"],
    tags: ["All ages", "Community events", "Custom playlists"],
    bio:
      "Camille brings welcoming, culturally fluent line dance instruction to celebrations, campuses, and company events.",
    sampleFormat: ["Playlist consult", "All-ages warmup", "Beginner and intermediate options"]
  },
  {
    slug: "riley-stone-phoenix-az",
    name: "Riley Stone",
    business: "Desert Step Events",
    city: "Phoenix",
    state: "AZ",
    zip: "85004",
    travelRadius: 100,
    years: 8,
    startingRate: 400,
    minHours: 2,
    groupSize: 200,
    founding: true,
    featured: false,
    rating: 4.8,
    reviews: 26,
    styles: ["Country", "Western theme", "Venue nights"],
    events: ["venues", "weddings", "bachelorette-parties", "private-parties"],
    tags: ["Western theme", "Venue programming", "Travels statewide"],
    bio:
      "Riley teaches upbeat western and pop line dances for Arizona weddings, venues, and private parties.",
    sampleFormat: ["Theme consultation", "Beginner dance lesson", "Host-led encore"]
  }
];
