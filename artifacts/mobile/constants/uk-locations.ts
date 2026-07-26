// Curated offline list of UK towns, cities and areas used for the
// "Service areas" autocomplete in the trader business profile. Purely a
// suggestion source — traders can always type a place that isn't listed
// (villages, estates, postcodes areas etc.). No external provider is used.

export const UK_LOCATIONS: string[] = [
  // London & boroughs
  "London", "Central London", "North London", "South London", "East London", "West London",
  "Barking", "Barnet", "Bexley", "Brent", "Bromley", "Camden", "Croydon", "Ealing",
  "Enfield", "Greenwich", "Hackney", "Hammersmith", "Haringey", "Harrow", "Havering",
  "Hillingdon", "Hounslow", "Islington", "Kensington", "Chelsea", "Kingston upon Thames",
  "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge", "Richmond upon Thames",
  "Southwark", "Sutton", "Tower Hamlets", "Waltham Forest", "Wandsworth", "Westminster",
  "Wembley", "Ilford", "Romford", "Uxbridge", "Twickenham", "Wimbledon", "Stratford",
  "Walthamstow", "Woolwich", "Orpington", "Dagenham", "Edgware", "Finchley", "Tottenham",

  // South East
  "Brighton", "Hove", "Eastbourne", "Hastings", "Worthing", "Crawley", "Horsham",
  "Guildford", "Woking", "Epsom", "Reigate", "Redhill", "Farnham", "Camberley",
  "Reading", "Slough", "Bracknell", "Maidenhead", "Windsor", "Newbury", "Basingstoke",
  "Winchester", "Southampton", "Portsmouth", "Fareham", "Gosport", "Havant", "Eastleigh",
  "Andover", "Aldershot", "Farnborough", "Milton Keynes", "Aylesbury", "High Wycombe",
  "Oxford", "Banbury", "Bicester", "Abingdon", "Didcot", "Witney",
  "Maidstone", "Canterbury", "Ashford", "Folkestone", "Dover", "Margate", "Ramsgate",
  "Chatham", "Gillingham", "Rochester", "Gravesend", "Dartford", "Sevenoaks",
  "Tonbridge", "Tunbridge Wells", "Sittingbourne", "Faversham", "Whitstable",
  "Bognor Regis", "Chichester", "Littlehampton", "Haywards Heath", "Burgess Hill",
  "Isle of Wight", "Newport", "Ryde",

  // East of England
  "Cambridge", "Peterborough", "Ely", "Huntingdon", "St Neots", "Wisbech",
  "Norwich", "Great Yarmouth", "King's Lynn", "Thetford",
  "Ipswich", "Bury St Edmunds", "Lowestoft", "Felixstowe",
  "Chelmsford", "Colchester", "Southend-on-Sea", "Basildon", "Harlow", "Brentwood",
  "Braintree", "Witham", "Clacton-on-Sea", "Grays", "Thurrock", "Loughton", "Epping",
  "Luton", "Bedford", "Dunstable", "Leighton Buzzard",
  "St Albans", "Watford", "Hemel Hempstead", "Stevenage", "Welwyn Garden City",
  "Hatfield", "Hertford", "Hitchin", "Letchworth", "Cheshunt", "Borehamwood", "Rickmansworth",

  // South West
  "Bristol", "Bath", "Weston-super-Mare", "Gloucester", "Cheltenham", "Stroud",
  "Swindon", "Salisbury", "Chippenham", "Trowbridge",
  "Bournemouth", "Poole", "Christchurch", "Weymouth", "Dorchester",
  "Exeter", "Plymouth", "Torquay", "Paignton", "Exmouth", "Barnstaple", "Newton Abbot",
  "Truro", "Falmouth", "St Austell", "Penzance", "Newquay", "Bodmin",
  "Taunton", "Yeovil", "Bridgwater", "Frome", "Glastonbury",

  // West Midlands
  "Birmingham", "Solihull", "Sutton Coldfield", "Wolverhampton", "Walsall",
  "West Bromwich", "Dudley", "Stourbridge", "Halesowen", "Smethwick",
  "Coventry", "Nuneaton", "Rugby", "Leamington Spa", "Warwick", "Stratford-upon-Avon",
  "Worcester", "Redditch", "Kidderminster", "Bromsgrove", "Malvern",
  "Hereford", "Shrewsbury", "Telford", "Stafford", "Stoke-on-Trent", "Newcastle-under-Lyme",
  "Burton upon Trent", "Cannock", "Lichfield", "Tamworth",

  // East Midlands
  "Nottingham", "Derby", "Leicester", "Loughborough", "Mansfield", "Chesterfield",
  "Newark-on-Trent", "Grantham", "Lincoln", "Boston", "Skegness", "Scunthorpe", "Grimsby",
  "Northampton", "Kettering", "Corby", "Wellingborough", "Rushden",
  "Hinckley", "Melton Mowbray", "Coalville", "Ilkeston", "Long Eaton", "Beeston", "Worksop",

  // North West
  "Manchester", "Salford", "Stockport", "Bolton", "Bury", "Rochdale", "Oldham",
  "Wigan", "Sale", "Altrincham", "Stretford", "Ashton-under-Lyne",
  "Liverpool", "Birkenhead", "Wallasey", "Bootle", "St Helens", "Widnes", "Runcorn",
  "Warrington", "Chester", "Crewe", "Macclesfield", "Northwich", "Ellesmere Port",
  "Preston", "Blackpool", "Blackburn", "Burnley", "Lancaster", "Southport", "Chorley",
  "Accrington", "Morecambe", "Lytham St Annes", "Skelmersdale",
  "Carlisle", "Barrow-in-Furness", "Kendal", "Workington", "Penrith",

  // Yorkshire & the Humber
  "Leeds", "Sheffield", "Bradford", "Hull", "York", "Wakefield", "Huddersfield",
  "Halifax", "Doncaster", "Rotherham", "Barnsley", "Harrogate", "Scarborough",
  "Keighley", "Dewsbury", "Batley", "Castleford", "Pontefract", "Beverley",
  "Selby", "Skipton", "Ripon", "Northallerton", "Goole",

  // North East
  "Newcastle upon Tyne", "Gateshead", "Sunderland", "South Shields", "North Shields",
  "Whitley Bay", "Washington", "Durham", "Darlington", "Hartlepool",
  "Middlesbrough", "Stockton-on-Tees", "Redcar", "Billingham",
  "Hexham", "Morpeth", "Blyth", "Cramlington", "Alnwick", "Berwick-upon-Tweed",
  "Consett", "Bishop Auckland", "Chester-le-Street",

  // Wales
  "Cardiff", "Swansea", "Newport (Wales)", "Wrexham", "Barry", "Neath", "Port Talbot",
  "Bridgend", "Llanelli", "Merthyr Tydfil", "Caerphilly", "Pontypridd", "Cwmbran",
  "Aberdare", "Colwyn Bay", "Rhyl", "Bangor", "Llandudno", "Aberystwyth",
  "Carmarthen", "Haverfordwest", "Pembroke", "Monmouth", "Abergavenny", "Penarth",

  // Scotland
  "Glasgow", "Edinburgh", "Aberdeen", "Dundee", "Inverness", "Perth", "Stirling",
  "Paisley", "East Kilbride", "Livingston", "Hamilton", "Cumbernauld", "Kirkcaldy",
  "Dunfermline", "Ayr", "Kilmarnock", "Greenock", "Coatbridge", "Airdrie",
  "Falkirk", "Motherwell", "Wishaw", "Clydebank", "Dumbarton", "Dumfries",
  "Elgin", "St Andrews", "Glenrothes", "Bathgate",

  // Northern Ireland
  "Belfast", "Derry", "Lisburn", "Newtownabbey", "Bangor (NI)", "Craigavon",
  "Ballymena", "Newry", "Carrickfergus", "Coleraine", "Antrim", "Omagh",
  "Larne", "Armagh", "Enniskillen",
];
