export const site = {
  name: "Hire Line Dancers",
  url: "https://hirelinedancers.com",
  email: "hello@hirelinedancers.com",
  description:
    "Hire a line dance instructor and get more guests moving together. Beginner-friendly, no prior dance experience required. A participatory activity for weddings, corporate events, and private parties."
};

export const eventTypes = [
  {
    slug: "weddings",
    label: "Weddings",
    title: "Wedding Line Dance Instructors",
    bookingHint: "Ceremonies, receptions, welcome parties, and wedding weekends",
    intro:
      "Give guests a low-pressure way to fill the dance floor with a guided line dance lesson between dinner, speeches, and open dancing.",
    searches: ["wedding line dance instructor", "country wedding entertainment", "group dance for wedding"]
  },
  {
    slug: "corporate-events",
    label: "Corporate events",
    title: "Corporate Line Dancing",
    bookingHint: "Offsites, conferences, retreats, holiday parties, and team events",
    intro:
      "Book a polished group activity for offsites, conferences, holiday parties, retreats, and team-building programs.",
    searches: ["corporate line dancing", "team building dance instructor", "corporate event entertainment"]
  },
  {
    slug: "bachelorette-parties",
    label: "Bachelorette parties",
    title: "Bachelorette Line Dancing",
    bookingHint: "Private group lessons, destination weekends, and themed parties",
    intro:
      "Plan a fun, themed private lesson that works for mixed experience levels and gives the group something memorable to do together.",
    searches: ["bachelorette line dancing", "private line dance class", "country party activity"]
  },
  {
    slug: "bar-bat-mitzvahs",
    label: "Bar and bat mitzvahs",
    title: "Bar and Bat Mitzvah Line Dance Instructors",
    bookingHint: "Beginner-friendly instruction for multigenerational celebrations",
    intro:
      "Turn a multigenerational celebration into a shared experience with simple instruction that welcomes kids, teens, parents, and grandparents.",
    searches: ["bar mitzvah dance instructor", "bat mitzvah group dance", "bar mitzvah entertainment ideas"]
  },
  {
    slug: "private-parties",
    label: "Private parties",
    title: "Private Party Line Dance Instructors",
    bookingHint: "Birthdays, reunions, backyard parties, and milestone celebrations",
    intro:
      "Bring a beginner-friendly instructor to birthdays, reunions, backyard parties, and milestone celebrations.",
    searches: ["private line dance class", "dance instructor for party", "group dance entertainment"]
  },
  {
    slug: "fundraisers",
    label: "Fundraisers",
    title: "Line Dance Instructors for Fundraisers",
    bookingHint: "Charity events, school fundraisers, galas, and benefit programs",
    intro:
      "Give supporters an inclusive activity that builds energy, encourages participation, and creates a memorable moment around the cause.",
    searches: ["fundraiser line dancing", "dance instructor for charity event", "interactive fundraiser entertainment"]
  },
  {
    slug: "summer-camps",
    label: "Summer camps",
    title: "Summer Camp Line Dance Instructors",
    bookingHint: "One-time activities, theme days, and recurring camp programs",
    intro:
      "Add an active, screen-free group experience that can be adapted to different ages, schedules, group sizes, and camp themes.",
    searches: ["summer camp dance instructor", "line dancing for summer camp", "camp group activity"]
  },
  {
    slug: "after-school-programs",
    label: "After-school programs",
    title: "After-School Line Dance Programs",
    bookingHint: "School enrichment, youth programs, clubs, and activity series",
    intro:
      "Bring structured movement, music, and social participation to an after-school program with lessons designed for the students in the room.",
    searches: ["after school dance instructor", "line dancing after school program", "school enrichment dance class"]
  },
  {
    slug: "fitness-classes",
    label: "Fitness classes and studios",
    title: "Fitness Line Dance Classes and Studio Programs",
    bookingHint: "Fitness studios, gyms, wellness programs, and recurring classes",
    intro:
      "Offer a social, music-driven fitness class that keeps people moving while giving participants clear steps and a welcoming way to join in.",
    searches: ["fitness line dance instructor", "line dance fitness class", "dance fitness class for studio"]
  },
  {
    slug: "venues",
    label: "Venues and bars",
    title: "Line Dance Instructors for Venues",
    bookingHint: "Country nights, public lessons, breweries, bars, and recurring events",
    intro:
      "Find instructors for country nights, recurring programming, brewery events, bars, and public dance nights.",
    searches: ["line dance instructor for country night", "teach line dancing at bar", "venue dance instructor"]
  },
  {
    slug: "schools-community",
    label: "Schools and community",
    title: "School and Community Line Dancing",
    bookingHint: "Schools, colleges, senior centers, and community organizations",
    intro:
      "Book a safe, participatory activity for schools, colleges, senior centers, public programs, and community organizations.",
    searches: ["line dancing school event", "group dance instructor near me", "community dance instructor"]
  }
];

export type LaunchCity = {
  slug: string;
  city: string;
  state: string;
  blurb: string;
  localIntro: string;
  planningNote: string;
  serviceCities: string[];
};

// The single source of truth for the eleven launch markets used across navigation,
// search, event pages, city routes, editorial content, and the sitemap.
export const cities: LaunchCity[] = [
  {
    slug: "nashville-tn",
    city: "Nashville",
    state: "TN",
    blurb: "A deep line dance culture and a steady calendar of weddings, company events, and group celebrations.",
    localIntro: "Nashville groups often want an activity that feels connected to the city while still welcoming guests who have never danced before.",
    planningNote: "Ask about destination-group experience, venue sound, lesson timing, and travel outside central Nashville.",
    serviceCities: ["Nashville"]
  },
  {
    slug: "fort-worth-tx",
    city: "Fort Worth",
    state: "TX",
    blurb: "Western event traditions, large gathering spaces, and a natural fit for participatory group dancing.",
    localIntro: "Fort Worth is a strong match for guided line dancing at western-themed company events, weddings, private parties, and community gatherings.",
    planningNote: "Confirm floor surface, group size, sound coverage, and whether travel elsewhere in the DFW area affects the quote.",
    serviceCities: ["Fort Worth"]
  },
  {
    slug: "austin-tx",
    city: "Austin",
    state: "TX",
    blurb: "Company offsites, Hill Country weddings, and private groups looking for an activity everyone can try.",
    localIntro: "Austin events can pair the energy of a Texas dance hall with beginner-friendly instruction designed for coworkers, wedding guests, and visiting groups.",
    planningNote: "Discuss venue location, indoor or outdoor plans, available sound, and travel into the Hill Country.",
    serviceCities: ["Austin"]
  },
  {
    slug: "dallas-tx",
    city: "Dallas",
    state: "TX",
    blurb: "A large corporate and wedding market with room for country, soul, and pop line dance experiences.",
    localIntro: "Dallas instructors may work with everything from intimate private groups to large ballroom audiences, so event scale matters when choosing a fit.",
    planningNote: "Share the room layout, expected participant count, music preferences, microphone access, and DFW travel details.",
    serviceCities: ["Dallas"]
  },
  {
    slug: "houston-tx",
    city: "Houston",
    state: "TX",
    blurb: "A diverse event market where one accessible activity can bring a multigenerational room together.",
    localIntro: "Houston events benefit from instructors who can adapt the playlist, teaching style, and pace to a broad mix of ages and musical tastes.",
    planningNote: "Confirm travel time across Greater Houston, indoor or outdoor conditions, sound coverage, and the songs or styles your guests will enjoy.",
    serviceCities: ["Houston"]
  },
  {
    slug: "san-francisco-ca",
    city: "San Francisco Bay Area",
    state: "CA",
    blurb: "An inclusive dance community and a strong market for company gatherings, weddings, and social events.",
    localIntro: "The Bay Area is a natural place for a welcoming group activity that helps coworkers, friends, and families move together without needing prior dance experience.",
    planningNote: "Be specific about the venue city, traffic-sensitive travel, parking or load-in, floor space, and available sound equipment.",
    serviceCities: ["San Francisco", "Oakland", "Berkeley", "San Jose"]
  },
  {
    slug: "new-york-ny",
    city: "New York City metro",
    state: "NY",
    blurb: "A dense event market serving company gatherings, weddings, private celebrations, and community programs across the city and nearby areas.",
    localIntro: "The New York City area is a strong fit for a guided activity that helps coworkers, families, and guests participate together without needing previous dance experience.",
    planningNote: "Share the borough or nearby city, venue access, floor space, sound setup, and travel expectations across New York, New Jersey, Long Island, or Westchester.",
    serviceCities: ["New York", "New York City", "Brooklyn", "Queens", "Bronx", "Staten Island", "Jersey City", "Hoboken", "White Plains"]
  },
  {
    slug: "phoenix-az",
    city: "Phoenix and Scottsdale",
    state: "AZ",
    blurb: "Resort gatherings, desert weddings, and private celebrations that benefit from an easy shared activity.",
    localIntro: "Phoenix and Scottsdale events can use line dancing as a participatory addition to resort programs, weddings, company gatherings, and private weekends.",
    planningNote: "For outdoor plans, discuss heat, shade, flooring, power, sound, and an indoor backup before confirming the format.",
    serviceCities: ["Phoenix", "Scottsdale", "Tempe", "Mesa"]
  },
  {
    slug: "atlanta-ga",
    city: "Atlanta",
    state: "GA",
    blurb: "Country and soul line dance traditions serving corporate, community, wedding, and family events.",
    localIntro: "Atlanta groups may want country, soul, pop, or a thoughtful mix, making playlist and teaching experience especially important when choosing an instructor.",
    planningNote: "Discuss musical style, ages, group size, venue sound, parking, and travel across the metro area.",
    serviceCities: ["Atlanta"]
  },
  {
    slug: "charlotte-nc",
    city: "Charlotte",
    state: "NC",
    blurb: "Company gatherings, weddings, reunions, and community events looking for a comfortable way to participate.",
    localIntro: "Charlotte line dance experiences can work across company celebrations, weddings, family gatherings, and community programs when the instruction starts with true beginners.",
    planningNote: "Share the event schedule, ages, participant count, sound setup, and whether the instructor will travel beyond central Charlotte.",
    serviceCities: ["Charlotte"]
  },
  {
    slug: "las-vegas-nv",
    city: "Las Vegas",
    state: "NV",
    blurb: "Conventions, destination weddings, and group trips where shared entertainment is central to the experience.",
    localIntro: "Las Vegas planners can use a guided group dance to turn a room of conference attendees, wedding guests, or friends into active participants.",
    planningNote: "Hotel and convention venues may have vendor, insurance, load-in, sound, and access requirements, so confirm them early.",
    serviceCities: ["Las Vegas"]
  }
];

export const topCities = cities;

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
  favoriteSong?: {
    name: string;
    spotifyUrl?: string;
  };
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
    sampleFormat: ["15-minute warmup", "Two crowd-pleaser dances", "Photo-ready group finale"],
    favoriteSong: {
      name: "Boot Scootin' Boogie by Brooks & Dunn",
      spotifyUrl: "https://open.spotify.com/track/7Fq9RwQxSn3kW85PrDUf0M"
    }
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
    tags: ["Large groups", "School/community friendly", "Country and soul"],
    bio:
      "Jordan leads polished lessons for large rooms, from company celebrations to school events and venue programming.",
    sampleFormat: ["Room reset", "Call-and-response teaching", "Optional team dance-off"]
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
