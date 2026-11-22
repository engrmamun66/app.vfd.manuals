# MASTER PROMPT: MULTI-BRAND VFD TECHNICAL KNOWLEDGE BASE & RESEARCH EXPLORER

## 1. ROLE & RESPONSIBILITY

Act as a Senior Full-Stack Developer, Industrial Automation Engineer,
VFD Technical Documentation Analyst, Database Architect, and Technical
Research System Designer.

Your task is to design and develop a complete, professional, locally
hosted web application called:

**VFD Knowledge Base & Technical Research Explorer**

This application will consolidate technical information from multiple
Variable Frequency Drive (VFD) manufacturers into a unified,
standardized, searchable, and research-oriented knowledge platform.

This is NOT just a PDF viewer, a simple parameter list, or a
documentation summarizer.

It must be a comprehensive technical knowledge platform where users can:

-   Search common VFD functions across multiple brands and models.
-   Compare different manufacturers' parameters side by side.
-   Explore motor configuration, electrical settings, control modes,
    protection functions, and communication settings.
-   Find Modbus RTU / RS485 register addresses and their technical
    details.
-   Trace every technical value back to its original documentation.
-   Navigate from a simple parameter explanation to deep technical
    documentation and original manual references.
-   Add new VFD brands, models, and documentation in the future without
    changing the fundamental database architecture.

The system must be expandable and designed to support at least 30--50
VFD models over time.

------------------------------------------------------------------------

# 2. MOST IMPORTANT RULE: 100% DOCUMENTATION-BASED INFORMATION

This is the most important requirement of the entire project.

**Every technical fact stored or displayed in the application must be
supported by the original manufacturer documentation.**

The application must NEVER generate, assume, approximate, or invent
technical values.

Strictly follow these rules:

1.  Never invent a parameter code.
2.  Never invent a Modbus register address.
3.  Never assume two brands use the same register address.
4.  Never assume that two similarly named parameters have identical
    behavior.
5.  Never assume a default value.
6.  Never assume a setting range.
7.  Never assume a scaling factor.
8.  Never assume a communication function code.
9.  Never infer undocumented parameter relationships.
10. Never use general internet knowledge as a substitute for
    manufacturer documentation.

If information is unavailable in the provided documentation, display:

`Not Documented`

If information is found but cannot be verified:

`Unverified`

If the documentation is unclear or unreadable:

`Requires Manual Verification`

If two official documents contain conflicting values:

`Documentation Conflict`

Show both sources and explain the conflict without choosing an arbitrary
value.

### Evidence Classification

Every technical record must have an evidence classification:

-   Explicitly Documented: Directly stated in the manufacturer manual.
-   Calculated from Documented Data: Derived using a clearly documented
    formula.
-   Cross-Referenced: Supported by another documented section.
-   Not Documented: No supporting information found.
-   Unverified: Information exists but cannot be confirmed.
-   Conflicting: Different official documents provide conflicting
    information.

Never present calculated information as directly documented information.

All calculated values must retain their original inputs, formula, and
source references.

------------------------------------------------------------------------

# 3. EXISTING DOCUMENTATION DIRECTORY

The current documentation directory is:

``` text
vfd-manuals/
│
├── HEX values.jpeg
│
├── Altivar/
│   ├── ATV312H037M2.jpeg
│   └── VFD_ATV312_programming_manual.pdf
│
├── Clvdrives/
│   ├── 900 series Inverter User Guide.pdf
│   └── WhatsApp Image 2026-11-19 at 6.18.23 AM (2).jpeg
│
├── Delta/
│   ├── Delta-VFD-EL-Series-Users-Manual.jpeg
│   └── Delta-VFD-EL-Series-Users-Manual.pdf
│
├── FRENIC/
│   └── FRENIC-Mini-C2-instruction-manual.pdf
│
├── Fuji/
│   ├── Fuji-FRN0004C2S-4A.pdf
│   └── Fuji.jpeg
│
├── OMRON/
│   └── OMRON i570_mx2_users_manual_en.pdf
│
├── Schneider-A/
│
├── Sciemence/
│   └── v20_operating_instructions_complete_en-US_en-US.pdf
│
└── Yaskawa/
    ├── Yaskawa-V1000-CIMR-VC-Guide -- heavy.pdf
    ├── Yaskawa-V1000-CIMR-VC-Guide -- light.pdf
    └── Yaskawa.jpeg
```

Important:

-   The directory will grow over time.
-   More than 15--20 additional manuals may be added.
-   New brands and models may be introduced at any time.
-   Some documentation may be PDF, scanned PDF, JPEG, or other supported
    document formats.
-   Some files may contain product images, parameter tables, wiring
    diagrams, Modbus tables, and technical illustrations.
-   Some folders may initially be empty.

### Documentation Processing Requirements

Build a documentation ingestion system that:

1.  Recursively scans the documentation directory.
2.  Identifies document formats.
3.  Extracts searchable text from PDFs.
4.  Detects scanned PDFs and performs OCR when necessary.
5.  Processes JPEG images using OCR or visual analysis.
6.  Preserves page numbers and document locations.
7.  Detects duplicate files.
8.  Associates documents with the correct brand and model.
9.  Allows new documentation to be imported later.
10. Tracks document revisions and versions.

Do not assume a folder name always correctly identifies a product model.
Verify the model using the actual document content.

If a document's brand or model is uncertain, mark it for manual review.

Do not discard original documents after extracting information.

------------------------------------------------------------------------

# 4. TECHNOLOGY STACK

Build a fully functional local web application.

## Backend

-   Runtime: Node.js
-   Framework: Express.js
-   Language: JavaScript or TypeScript (prefer TypeScript if practical)
-   API: REST API

## Database

Use SQLite.

Recommended Node.js driver:

`better-sqlite3`

The entire structured database must be stored in a portable file:

`database/vfd-knowledge.db`

Strict requirements:

-   No MySQL.
-   No PostgreSQL.
-   No MongoDB.
-   No external database server.
-   No mandatory cloud database.
-   No paid database service.
-   No external database infrastructure.

The database must be portable and transferable between computers.

All application data should be accessible through the local application.

## Frontend

Recommended:

-   React
-   Vite
-   TypeScript
-   Modern responsive UI
-   Reusable components

You may choose an alternative frontend architecture if there is a strong
technical reason, but keep Node.js and SQLite as the core architecture.

## Document Storage

Keep original documents in a local directory.

Example:

``` text
storage/
├── manuals/
├── extracted-text/
├── page-images/
├── thumbnails/
└── ocr-results/
```

Do not store all PDF binary contents directly inside SQLite.

Store document metadata, references, extracted text, and relationships
in SQLite. Keep original files in local storage.

## Local Execution

The application must run locally.

Example:

``` bash
npm install
npm run dev
```

Production execution should also be supported:

``` bash
npm run build
npm start
```

The application should open through a local browser URL, such as:

`http://localhost:3000`

No internet connection should be required for normal database browsing,
searching, filtering, and comparing after installation and document
processing.

------------------------------------------------------------------------

# 5. CORE KNOWLEDGE BASE ARCHITECTURE

The central concept is:

**One Common Technical Function → Multiple Brand-Specific
Implementations**

For example:

Maximum Frequency is one common technical function.

However, Siemens, Delta, Schneider, Fuji, and Yaskawa may use different
parameter codes, setting ranges, units, and operating restrictions.

All of them must be grouped under the same standardized technical
category.

Do not create separate unrelated categories just because manufacturers
use different terminology.

However, do not merge parameters that only appear similar but have
different technical meanings.

## 5.1 Standardized Categories

Create a flexible category system.

Initial categories should include:

### A. Motor & Electrical Configuration

-   Rated Motor Voltage
-   Rated Motor Current
-   Rated Motor Frequency
-   Rated Motor Power
-   Rated Motor Speed (RPM)
-   Motor Power Factor
-   Maximum Output Voltage
-   Minimum Output Voltage (if documented)
-   Maximum Output Current
-   Maximum Inverter Current
-   Motor Overload Factor
-   Motor Configuration
-   Motor Identification / Auto-Tuning

### B. Frequency Configuration

-   Minimum Frequency
-   Maximum Frequency
-   Rated Frequency
-   Output Frequency
-   Frequency Reference
-   Frequency Command
-   Frequency Upper Limit
-   Frequency Lower Limit
-   Frequency Resolution
-   Frequency Source Selection
-   Fixed Frequency
-   Multi-Step Frequency
-   Skip Frequency
-   Frequency Compensation

### C. Acceleration & Deceleration

-   Acceleration Time 1
-   Acceleration Time 2
-   Deceleration Time 1
-   Deceleration Time 2
-   S-Curve Acceleration
-   S-Curve Deceleration
-   Emergency Deceleration
-   Ramp Configuration
-   Acceleration / Deceleration Mode

### D. Operation & Command Control

-   Keypad / Internal Control
-   External Terminal Control
-   RS485 Control
-   Modbus Control
-   Start Command
-   Stop Command
-   Forward Command
-   Reverse Command
-   Jog Operation
-   Reset Command
-   Local / Remote Selection
-   Command Source Selection
-   Operation Mode Selection

### E. Frequency Reference & Input Sources

-   Keypad Frequency Reference
-   Analog Input 0--10V
-   Analog Input 4--20mA
-   Potentiometer Input
-   Digital Frequency Selection
-   Preset Frequency
-   RS485 Frequency Reference
-   Modbus Frequency Command
-   Pulse Input Frequency Reference
-   Frequency Source Selection

### F. Torque & Motor Control

-   Torque Compensation
-   Torque Boost
-   Torque Limit
-   Slip Compensation
-   V/F Control
-   Sensorless Vector Control
-   Vector Control
-   Motor Flux Control
-   DC Injection Braking
-   Dynamic Braking
-   Motor Control Mode

### G. Protection & Fault Management

-   Overcurrent Protection
-   Overvoltage Protection
-   Undervoltage Protection
-   Overload Protection
-   Motor Thermal Protection
-   Overtemperature Protection
-   Stall Prevention
-   Phase Loss Protection
-   Ground Fault Protection
-   Motor Protection
-   Fault Reset
-   Fault History
-   Automatic Restart
-   Protection Thresholds

### H. Digital & Analog I/O

-   Digital Input Configuration
-   Digital Output Configuration
-   Analog Input Configuration
-   Analog Output Configuration
-   Relay Output Configuration
-   Terminal Function Mapping
-   Input Logic Selection
-   Output Signal Assignment

### I. Modbus RTU / RS485 Communication

-   Communication Protocol
-   RS485 Wiring
-   Slave Address
-   Baud Rate
-   Data Bits
-   Parity
-   Stop Bits
-   Communication Timeout
-   Communication Loss Behavior
-   Function Codes
-   Holding Registers
-   Input Registers
-   Coil Addresses (if supported)
-   Frequency Command Register
-   Output Frequency Register
-   Output Current Register
-   Output Voltage Register
-   Status Register
-   Control Word
-   Fault Code Register
-   Communication Enable / Disable
-   Register Read / Write Permissions

### J. Advanced Configuration

-   Carrier Frequency
-   PWM Configuration
-   Energy Saving
-   PID Control
-   Sleep / Wake-up
-   Automatic Voltage Regulation
-   Braking Resistor Configuration
-   Motor Auto-Tuning
-   Special Application Settings

These are initial categories, not a limitation.

New categories and subcategories must be dynamically addable.

------------------------------------------------------------------------

# 6. STANDARDIZED PARAMETER DATA MODEL

Every technical parameter must be associated with a common function.

Example:

``` text
Category:
Frequency Configuration

Common Function:
Maximum Frequency

Brand:
Siemens

Model:
SINAMICS V20

Manufacturer Parameter:
P1082

Unit:
Hz

Source:
V20 Operating Instructions
```

A Delta model may have a completely different parameter code for the
same common function.

The common function remains the same.

The manufacturer-specific implementation must remain separate.

## Required Parameter Fields

Design the database to support:

-   Parameter ID
-   Common Function ID
-   Category ID
-   Brand ID
-   Model ID
-   Manufacturer Parameter Code
-   Manufacturer Parameter Name
-   English Description
-   Bengali Description
-   Technical Explanation
-   Unit
-   Data Type
-   Default Value
-   Minimum Value
-   Maximum Value
-   Resolution
-   Access Type (Read / Write / Read-Write)
-   Setting Conditions
-   Related Parameters
-   Evidence Status
-   Source Document ID
-   Source Page
-   Source Section
-   Source Table / Figure
-   Original Extracted Text
-   Verification Status
-   Created Date
-   Updated Date

All fields must support missing values.

Never fill missing information with assumed values.

------------------------------------------------------------------------

# 7. MODBUS / RS485 REGISTER DATABASE

This is a particularly important part of the application.

I work with Siemens S7-1200 PLCs, Delta VFDs, Siemens VFDs, and other
industrial devices.

Therefore, Modbus register information must be stored with a high level
of technical precision.

## Required Modbus Register Information

Each register should support:

-   Brand
-   VFD Model
-   Register Name
-   Common Function
-   Original Manufacturer Address
-   Original Address Format (HEX / Decimal)
-   Converted HEX Address
-   Converted Decimal Address
-   Register Type
-   Modbus Object Type
-   Function Code
-   Read / Write Permission
-   Data Length
-   Data Type
-   Signed / Unsigned
-   Byte Order
-   Word Order
-   Scaling Factor
-   Engineering Unit
-   Raw Value Interpretation
-   Register Description
-   Communication Restrictions
-   Source Manual
-   Page Number
-   Table Reference
-   Verification Status

## Address Handling Rules

This is extremely important.

Do not treat all address representations as interchangeable.

Clearly distinguish:

1.  Manufacturer's displayed register address.
2.  Hexadecimal register address.
3.  Decimal register address.
4.  Zero-based protocol offset.
5.  One-based register notation.
6.  Modbus 3xxxx / 4xxxx reference notation.
7.  PLC-specific communication instruction address.

Do not automatically add 40001 or any other offset unless the relevant
manufacturer's documentation and communication instruction explicitly
support that convention.

Keep the original address unchanged.

Any converted address must be stored separately with its conversion
method.

For example:

``` text
Original HEX Address: 2103H

Converted Decimal:
8451

Conversion:
0x2103 = 8451

Manufacturer:
Delta

Model:
VFD-EL

Function:
Actual Output Frequency
```

This is an example of address representation, not permission to assume
that every Modbus master uses the same address convention.

### Siemens S7-1200 Integration

Support technical documentation and reference information for Siemens
S7-1200 Modbus communication.

Include:

-   MB_COMM_LOAD
-   MB_MASTER
-   Appropriate communication interface configuration
-   Register addressing conventions
-   Function code selection
-   Data pointer configuration
-   Data type handling
-   Read operations
-   Write operations
-   Communication status
-   Error handling
-   Register conversion
-   PLC-side data interpretation

Do not invent the exact Siemens instruction parameter mapping or address
convention.

Use the relevant Siemens PLC and communication instruction documentation
when available.

Different TIA Portal versions and communication modules may require
different configurations.

Clearly identify version-specific differences.

------------------------------------------------------------------------

# 8. MULTI-BRAND COMPARISON ENGINE

This is one of the most important features.

Users must be able to compare multiple VFD brands and models
simultaneously.

Example:

User searches:

`Rated Motor Current`

The application should display a common comparison table.

Example layout:

  ----------------------------------------------------------------------
  Common         Siemens V20   Delta EL      Schneider     Fuji FRENIC
  Function                                   ATV312        
  -------------- ------------- ------------- ------------- -------------
  Rated Motor    Parameter     Parameter     Parameter     Parameter
  Current                                                  

  Rated Voltage  Parameter     Parameter     Parameter     Parameter

  Rated          Parameter     Parameter     Parameter     Parameter
  Frequency                                                

  Maximum        Parameter     Parameter     Parameter     Parameter
  Frequency                                                

  Acceleration   Parameter     Parameter     Parameter     Parameter
  Time                                                     

  Deceleration   Parameter     Parameter     Parameter     Parameter
  Time                                                     
  ----------------------------------------------------------------------

Important:

This is a UI example.

Only populate actual values when verified from the corresponding model's
documentation.

### Comparison Requirements

-   Compare 2--10 selected models.
-   Support multiple brands simultaneously.
-   Allow category-based comparison.
-   Allow common-function search.
-   Show missing information clearly.
-   Show source references for each individual value.
-   Allow users to open detailed parameter explanations.
-   Allow export to CSV and JSON.
-   Support filtering by brand, model, category, and parameter type.

### Important Technical Difference

Not every parameter with a similar name is necessarily equivalent.

Introduce a semantic equivalence classification:

-   Exact Equivalent
-   Functionally Similar
-   Partially Equivalent
-   Not Equivalent
-   Insufficient Documentation

Only Exact Equivalent functions should be grouped as direct equivalents.

Functionally Similar parameters can appear in comparison, but their
differences must be explained.

------------------------------------------------------------------------

# 9. DEEP RESEARCH EXPLORER

The application must include a dedicated research interface.

This feature should allow users to investigate any technical topic
progressively.

It should behave like a combination of:

-   Technical Knowledge Explorer
-   Documentation Browser
-   Breadcrumb Navigation
-   Expandable Research Panels
-   Source Evidence Viewer

## Research Navigation Example

``` text
VFD Knowledge Base
    ↓
Frequency Configuration
    ↓
Maximum Frequency
    ↓
Siemens SINAMICS V20
    ↓
Parameter P1082
    ↓
Technical Explanation
    ↓
Related Parameters
    ↓
Original Manual Section
    ↓
Original PDF Page
```

Users must be able to navigate as deeply as necessary.

### Level 1: Quick Overview

Display:

-   Common Function
-   Brand
-   Model
-   Parameter Code
-   Short Description
-   Value Range (if documented)
-   Unit
-   Help Icon

### Level 2: Detailed Explanation

Display:

-   Technical Description
-   Purpose
-   How the parameter works
-   Configuration conditions
-   Related parameters
-   Important restrictions
-   Manufacturer-specific behavior

Every statement must be supported by documentation.

### Level 3: Advanced Technical Explanation

Display:

-   Detailed operation
-   Parameter dependencies
-   Related control functions
-   Communication implications
-   Technical limitations
-   Differences between models
-   Documented examples

### Level 4: Source Investigation

Display:

-   Original document name
-   Document version
-   Page number
-   Section heading
-   Table number
-   Figure number
-   Original extracted text
-   Relevant screenshot or page image
-   Related documentation references

### Level 5: Original Documentation

Allow users to open the original PDF at the relevant page.

If possible, highlight the relevant text or table.

If text highlighting is not technically possible, display the
corresponding page image and source location.

## Breadcrumb Navigation

The research interface must always show the current navigation path.

Example:

``` text
Home
> Modbus
> Delta
> VFD-EL
> Output Frequency
> Register Details
> Scaling Information
```

Users must be able to click any previous breadcrumb item.

Support browser back navigation as well.

Do not force users to restart their research when moving between related
topics.

------------------------------------------------------------------------

# 10. HELP ICON & CONTEXTUAL EXPLANATION SYSTEM

Every parameter, Modbus register, and important technical term should
support contextual help.

Use a small information icon:

`ⓘ`

On click or hover, show a compact explanation.

Example:

``` text
Maximum Frequency  ⓘ
```

Short explanation:

"The maximum frequency defines the upper frequency limit allowed by the
drive."

Provide an option:

`Explore More`

When clicked, open the full technical explanation.

### Explanation Levels

1.  Short Description
2.  Detailed Explanation
3.  Advanced Technical Explanation
4.  Manufacturer-Specific Behavior
5.  Related Parameters
6.  Original Manual Evidence

The user must be able to expand and collapse each level.

Avoid overwhelming users with all technical details at once.

------------------------------------------------------------------------

# 11. DOCUMENTATION SOURCE & EVIDENCE VIEWER

Every important technical value must have a source reference.

Create a reusable source viewer.

Example:

``` text
Parameter: P1082

Source Document:
V20 Operating Instructions

Section:
Verified section title

Page:
Verified page number

Evidence:
Original text extracted from the manual.

[Open Original PDF]
[View Page Image]
[Show More Evidence]
```

### Evidence Requirements

-   Store source document ID.
-   Store original file name.
-   Store document revision.
-   Store actual PDF page index.
-   Store printed page number when available.
-   Store section heading.
-   Store table or figure reference.
-   Store original extracted text.
-   Store relevant page image when useful.

Important:

PDF physical page index and printed manual page number may differ.

Keep both separate.

Never fabricate page numbers or section names.

If the page number cannot be verified, display:

`Page Reference Not Verified`

### Source Traceability

A user should be able to move from:

Common Function → Brand Parameter → Register → Technical Explanation →
Original Source.

Every step should preserve its relationship to the original evidence.

------------------------------------------------------------------------

# 12. DATABASE ARCHITECTURE

Design a normalized, expandable SQLite schema.

Suggested tables:

``` text
brands
models
documents
document_revisions
document_pages
categories
subcategories
common_functions
parameters
parameter_values
parameter_relationships
modbus_registers
modbus_address_conversions
control_modes
control_commands
motor_configurations
protection_functions
evidence_records
source_references
technical_explanations
research_topics
research_relationships
verification_records
document_import_jobs
```

You may introduce additional tables where technically necessary.

### Database Requirements

-   Use proper foreign keys.
-   Use indexes for search performance.
-   Use unique constraints where appropriate.
-   Use database migrations.
-   Use transactions for imports.
-   Preserve source relationships.
-   Support nullable technical fields.
-   Support future schema expansion.
-   Track document revisions.
-   Track data verification status.
-   Avoid unnecessary duplication.

Do not hardcode brand-specific parameters into application code.

New brands, models, categories, and parameter mappings should be added
through the database.

------------------------------------------------------------------------

# 13. USER INTERFACE & EXPERIENCE

Build a professional industrial automation dashboard.

The interface should look like a modern technical research platform.

Avoid an ordinary admin dashboard appearance.

## Visual Design System

-   Use a strict black-and-white visual design as the default: black,
    white, and neutral grayscale only.
-   Prioritize legibility, smooth readable typography, clear hierarchy,
    consistent spacing, and uncluttered navigation.
-   Use restrained borders, subtle grayscale surfaces, and clear
    focus/hover states. Do not introduce decorative colors that reduce
    the monochrome visual identity.
-   Make technical tables, code values, register addresses, and source
    references easy to scan.
-   Keep controls and labels consistent throughout the application.
-   Provide accessible contrast, keyboard navigation, visible focus
    indicators, and responsive layouts.

## Research Workspace Width

The Deep Research Explorer and documentation research workspace must use
the full available viewport width on large displays, including screens
around 2500 pixels wide or wider.

-   Do not impose an arbitrary narrow `max-width` on the main research
    container.
-   Use the available viewport width for research content, comparison
    tables, source evidence, and document viewing.
-   Keep appropriate internal padding and readable line lengths for
    prose, but allow tables, diagrams, and document viewers to use the
    full available width.
-   Avoid leaving large unused margins on wide monitors.
-   Other compact forms or settings panels may use narrower widths where
    that improves usability; the full-width requirement specifically
    applies to research workspaces and technical content.

## Main Navigation

Suggested sidebar:

``` text
Dashboard

Knowledge Base
    All Parameters
    Motor Configuration
    Frequency Configuration
    Control Modes
    Protection
    Advanced Settings

Modbus & RS485
    Register Explorer
    Communication Settings
    Address Converter
    PLC Integration

Multi-Brand Comparison

Deep Research Explorer

Documentation Library
    Brands
    Models
    Manuals
    Import Documents

Verification Center

Settings
```

## Dashboard

Display:

-   Total Brands
-   Total VFD Models
-   Total Documents
-   Total Verified Parameters
-   Total Modbus Registers
-   Pending Verification
-   Recent Documentation Imports
-   Recently Updated Technical Records

All counts must come from the actual database.

Do not display fabricated statistics.

## Global Search

Implement a fast search system.

Users should be able to search using:

-   Common parameter names
-   Manufacturer parameter codes
-   Brand names
-   Model names
-   Modbus addresses
-   HEX values
-   Decimal values
-   Technical terms
-   English descriptions
-   Bengali descriptions

Search should support partial matches.

Example:

Searching:

`2103`

Should return matching register records, but only where the address is
actually present in the database.

## Filters

Support:

-   Brand
-   Model
-   Category
-   Subcategory
-   Communication Type
-   Parameter Type
-   Read / Write
-   Evidence Status
-   Verification Status

## Language

The UI must support Bengali and English technical content.

Use natural technical Bangla.

Keep standard engineering terminology in English where that improves
clarity.

Examples:

-   Maximum Frequency (সর্বোচ্চ ফ্রিকোয়েন্সি)
-   Rated Current (মোটরের নির্ধারিত কারেন্ট)
-   Acceleration Time (গতি বৃদ্ধির সময়)
-   Deceleration Time (গতি কমানোর সময়)
-   Output Frequency (আউটপুট ফ্রিকোয়েন্সি)

Do not translate parameter codes, register addresses, protocol terms, or
manufacturer-specific terminology.

------------------------------------------------------------------------

# 14. DOCUMENT IMPORT & KNOWLEDGE EXTRACTION WORKFLOW

Build a dedicated documentation import workflow.

The user should be able to add:

-   PDF manuals
-   Scanned PDF manuals
-   JPEG images
-   PNG images
-   Additional supported document formats

### Import Process

Step 1: Select or scan the documentation folder.

Step 2: Detect the file type.

Step 3: Identify manufacturer and model.

Step 4: Extract text and tables.

Step 5: Run OCR when necessary.

Step 6: Identify relevant technical categories.

Step 7: Extract parameters and register information.

Step 8: Extract source references.

Step 9: Validate extracted values.

Step 10: Present extracted records for review.

Step 11: Save approved records into SQLite.

### Human Verification

Provide an import review interface.

The user should be able to:

-   Review extracted parameter codes.
-   Compare extracted values with original page images.
-   Correct OCR errors.
-   Approve or reject records.
-   Mark records as unverified.
-   Reprocess a document.
-   View import errors.

Never silently approve uncertain OCR results.

### AI-Assisted Extraction

If an AI model is used for extraction, its output must be treated as
unverified until checked against the original documentation.

AI-generated explanations must not introduce undocumented facts.

The application must remain usable without a paid AI API.

AI integration should be optional and modular.

------------------------------------------------------------------------

# 15. CROSS-REFERENCE & RELATIONSHIP ENGINE

Create relationships between related technical functions.

Example:

Maximum Frequency may be related to:

-   Minimum Frequency
-   Rated Motor Frequency
-   Frequency Reference Source
-   Motor Rated Speed
-   Maximum Speed Limit
-   Acceleration Time
-   Deceleration Time

Modbus Output Frequency may be related to:

-   Frequency Command Register
-   Drive Status Register
-   Output Current Register
-   Communication Configuration

However, only create a documented technical dependency when the manual
supports it.

Distinguish between:

-   Documented Dependency
-   Documented Relationship
-   Related Function
-   Research Suggestion

Do not present a research suggestion as an established technical
dependency.

The user should be able to explore these relationships through clickable
links.

------------------------------------------------------------------------

# 16. MODBUS ADDRESS CONVERTER

Create a separate utility for Modbus address conversion.

Support:

-   HEX to Decimal
-   Decimal to HEX
-   Original address preservation
-   Register notation
-   Protocol offset representation
-   Manufacturer-specific address conventions

Display the conversion method.

Example:

``` text
HEX:
2103H

Decimal:
8451

Calculation:
0x2103 = 8451
```

This converter must only perform mathematical conversions.

It must NOT automatically decide that the result is a valid PLC address
or a valid 4xxxx Modbus reference.

Those interpretations must be based on the specific communication
manual.

Include a separate section explaining the difference between:

-   Manufacturer register address
-   Modbus PDU address
-   One-based register number
-   PLC instruction address

------------------------------------------------------------------------

# 17. EXPORT & PORTABILITY

The user must be able to export data.

Support:

-   Full SQLite database backup.
-   JSON export.
-   CSV export.
-   Category-wise export.
-   Brand-wise export.
-   Model-wise export.
-   Modbus register export.
-   Comparison report export.
-   Source reference export.

A database backup must preserve all relationships and technical evidence
metadata.

Provide an import/export system for moving the database between
computers.

Do not create a dependency on a remote database.

------------------------------------------------------------------------

# 18. PERFORMANCE & SEARCH

The system should support at least 30--50 models and thousands of
technical records.

Implement:

-   SQLite indexes.
-   Efficient SQL queries.
-   Pagination.
-   Search optimization.
-   Lazy loading for large documents.
-   Cached document metadata.
-   Efficient comparison queries.
-   Full-text search using SQLite FTS5 where appropriate.

Do not load all PDF files or all extracted page contents into browser
memory.

The research interface should load only the information currently
required.

------------------------------------------------------------------------

# 19. ERROR HANDLING & DATA INTEGRITY

Implement robust error handling.

Examples:

-   Missing source document.
-   Invalid document format.
-   OCR failure.
-   Unreadable page.
-   Duplicate manual.
-   Duplicate parameter.
-   Conflicting technical values.
-   Invalid Modbus address.
-   Missing source reference.
-   Failed import.
-   Database constraint violation.

Never silently discard extracted information.

Provide useful error messages.

Do not overwrite existing verified records automatically when importing
a new manual.

When a newer manual contains a different value, preserve both versions
and create a verification task.

------------------------------------------------------------------------

# 20. APPLICATION DEVELOPMENT REQUIREMENTS

Do not stop after writing a proposal or architecture document.

Your goal is to build the actual working application.

Follow this development process:

### Phase 1: Inspect the Environment

-   Inspect the available project directory.
-   Inspect the documentation directory.
-   Identify existing files and project structure.
-   Identify available development tools.
-   Do not assume every file can be accessed until verified.

### Phase 2: Architecture

Create:

-   Project architecture.
-   SQLite database schema.
-   Database migration system.
-   Backend structure.
-   Frontend structure.
-   Document storage structure.

### Phase 3: Core Application

Implement:

-   Local server.
-   SQLite integration.
-   Dashboard.
-   Brand management.
-   Model management.
-   Category management.
-   Parameter explorer.
-   Global search.
-   Filters.

### Phase 4: Comparison Engine

Implement:

-   Multi-brand selection.
-   Multi-model comparison.
-   Common function mapping.
-   Missing-data indicators.
-   Evidence links.

### Phase 5: Documentation System

Implement:

-   PDF import.
-   Image import.
-   OCR workflow.
-   Source page mapping.
-   Document library.
-   Evidence viewer.
-   Document version tracking.

### Phase 6: Deep Research Explorer

Implement:

-   Breadcrumb navigation.
-   Expandable explanations.
-   Contextual help icons.
-   Cross-references.
-   Related topics.
-   Original document viewer.
-   Research navigation history.

### Phase 7: Modbus & PLC Tools

Implement:

-   Modbus register explorer.
-   Address converter.
-   Register comparison.
-   Communication configuration reference.
-   Siemens S7-1200 integration reference.

### Phase 8: Multi-User, Authentication & Administration

Implement:

-   User registration or administrator-created accounts according to
    settings.
-   Secure login, logout, sessions, password hashing, and account status
    controls.
-   Role-based permissions and backend ownership enforcement.
-   User-specific storage directories and upload quotas.
-   Per-user comments, annotations, bookmarks, attachments, and
    settings.
-   Admin user management, activity logs, and storage monitoring.
-   Safe migration of all pre-existing personal records to an initial
    owner account.

### Phase 9: Full-Width Research UI & Split View

Implement:

-   Full-viewport-width research layouts without restrictive
    maximum-width containers.
-   Optional resizable split view for research content and source
    manual/page viewer.
-   One-click split-view enable/disable and adjustable panel
    proportions.
-   Preservation of the user's split-view and panel-size preferences.
-   Responsive behavior on wide desktop screens and smaller devices.
-   Original manufacturer diagrams, tables, charts, wiring drawings, and
    page images alongside related research.

### Phase 10: Testing

Test:

-   Database creation.
-   Database persistence.
-   CRUD operations.
-   Document imports.
-   Source reference integrity.
-   Parameter searches.
-   Multi-brand comparison.
-   Modbus conversion.
-   Breadcrumb navigation.
-   Browser refresh.
-   Database backup and restore.
-   Multi-user isolation and IDOR protection.
-   Authentication, session expiry, and role permissions.
-   User-specific file paths and storage quota calculations.
-   Admin monitoring counts against actual database/filesystem data.
-   Existing-data ownership migration.
-   Split-view resizing, full-width layout, and browser persistence.
-   Original manual diagrams and page-image source references.

### Phase 11: Final Delivery

Provide:

-   Complete source code.
-   SQLite database.
-   Database schema and migrations.
-   Installation instructions.
-   Running instructions.
-   Project structure.
-   Documentation.
-   Example workflow.
-   Test results.

------------------------------------------------------------------------

# 21. DEVELOPMENT RULES

Follow these rules throughout development:

1.  Write clean, maintainable, modular code.
2.  Use reusable frontend components.
3.  Keep database queries separate from UI logic.
4.  Use proper validation.
5.  Use transactions for data imports.
6.  Do not hardcode technical values.
7.  Do not hardcode brand-specific parameter mappings.
8.  Keep technical evidence linked to every verified record.
9.  Maintain compatibility with future brands and models.
10. Keep the UI responsive.
11. Keep all user data locally stored.
12. Avoid unnecessary dependencies.
13. Do not introduce paid APIs as mandatory dependencies.
14. Provide clear error messages.
15. Test important functionality before marking it complete.

Do not use mock technical values in production records.

If demonstration data is required, clearly label it:

`DEMO DATA – NOT VERIFIED`

Never mix demo records with verified manufacturer data.

------------------------------------------------------------------------

# 22. ACCEPTANCE CRITERIA

The project will be considered successful only when the following
conditions are met:

### Knowledge Base

-   Multiple VFD brands can coexist.
-   Multiple models per brand are supported.
-   Common technical functions are standardized.
-   Brand-specific parameters remain separate.
-   Missing information is clearly identified.

### Comparison

-   Multiple models can be compared simultaneously.
-   Common categories display side-by-side values.
-   Each value has its own source reference.
-   Functional differences are explained.

### Documentation

-   Original PDF and image files remain accessible.
-   Source page references are preserved.
-   Scanned documents can be processed through OCR.
-   Document revisions are tracked.

### Deep Research

-   Every parameter can be explored progressively.
-   Breadcrumb navigation works.
-   Users can return to previous research levels.
-   Help icons display compact explanations.
-   Deep explanations link to original sources.

### Modbus

-   HEX and Decimal conversion works.
-   Original addresses are preserved.
-   Different address conventions are distinguished.
-   Scaling factors and data types are documented.
-   Siemens PLC integration information is model/version aware.

### Portability

-   Database is stored in a portable SQLite file.
-   Application runs locally.
-   No MySQL/PostgreSQL server is required.
-   Backup and restore work.
-   New documentation can be added without redesigning the application.

### Accuracy

-   No fabricated technical values.
-   No unsupported parameter mappings.
-   No guessed register addresses.
-   No undocumented default values.
-   No misleading source references.
-   Unverified information is never presented as verified.

------------------------------------------------------------------------

# 23. FINAL INSTRUCTIONS TO CLAUDE

Before starting development, carefully understand the complete
requirements.

Do not rush into coding before understanding the database architecture
and evidence model.

First inspect the actual available documentation.

Then design the database so that all future VFD models can be added
without changing the fundamental structure.

Prioritize technical accuracy, evidence traceability, usability, and
long-term expandability over visual decoration.

The application should feel like a professional industrial automation
research platform.

The user is an industrial automation learner/engineer who works with:

-   Siemens S7-1200 PLC
-   Siemens SINAMICS V20
-   Delta VFD
-   Modbus RTU
-   RS485 Communication
-   Industrial Motor Control
-   VFD Parameter Configuration
-   PLC-VFD Integration

Therefore, make the application particularly useful for practical
engineering work.

Use clear Bengali-English mixed technical explanations.

Keep manufacturer parameter codes, Modbus addresses, technical units,
and standard engineering terms unchanged.

### MOST IMPORTANT FINAL PRINCIPLE

**The original manufacturer documentation is the single source of truth
for all manufacturer-specific technical information.**

The application must make it easy to answer these questions:

1.  What is this technical function?
2.  How does each VFD brand implement it?
3.  What is the exact parameter code for each model?
4.  What is the corresponding Modbus register address?
5.  How is it configured?
6.  What are its documented limits and conditions?
7.  Which other parameters are related?
8.  Where exactly is this information documented?
9.  Can I open the original manual and verify it myself?

The final product must answer these questions through a clean, fast,
expandable, and deeply navigable local web application.

**Build the actual application, not just a conceptual prototype.**

# ADDITIONAL MASTER REQUIREMENTS

## 24. ADMIN PANEL & FRONTEND CONTENT MANAGEMENT SYSTEM

The application must include a dedicated **Admin / Content Management**
page.

The purpose is to allow me to control how information is organized,
displayed, hidden, and prioritized throughout the application directly
from the frontend.

I do not want to edit source code whenever I need to change the
visibility or display order of information.

### 24.1 Content Visibility Management

From the Admin Panel, I must be able to control the visibility of:

-   Brands
-   VFD Models
-   Technical Categories
-   Subcategories
-   Common Functions
-   Parameters
-   Modbus Registers
-   Technical Research Topics
-   Documentation and Manuals
-   Other relevant knowledge-base sections

For each manageable item, provide controls such as:

-   Visible / Hidden
-   Active / Inactive
-   Show / Hide on Dashboard
-   Show / Hide in Navigation
-   Show / Hide in Search Results (where applicable)

Hiding an item must NOT delete its database records.

Hidden information must remain safely stored and recoverable.

For example, I may have 10 VFD models in the database but want only 5
models to appear in the normal Knowledge Base interface.

The remaining models should stay in the database but remain hidden until
I enable them.

### 24.2 Display Order Management

I must be able to control the display priority and ordering of content.

Examples:

-   Which brand appears first.
-   Which VFD model appears first under a brand.
-   Which category appears first in the Knowledge Base.
-   Which categories appear at the top of the navigation menu.
-   Which technical functions appear first.
-   Which documents appear first in the Documentation Library.
-   Which items appear in featured or priority sections.

Provide a simple drag-and-drop sorting interface where practical.

Also support numerical display-order values as a fallback.

The ordering must be saved in SQLite and remain persistent after
restarting the application.

Do not rely on temporary frontend array ordering.

### 24.3 Admin Dashboard

Create a dedicated Admin Dashboard with organized sections:

1.  Content Visibility
2.  Display Order Management
3.  Brand Management
4.  Model Management
5.  Category Management
6.  Documentation Management
7.  Knowledge Base Management
8.  Navigation Management
9.  General Application Settings

The interface should allow me to search, filter, edit, enable, disable,
hide, show, and reorder records.

Use confirmation dialogs for potentially destructive operations.

Never permanently delete technical records merely because I hide them.

### 24.4 Backend and Database Support

Although the application is locally hosted and uses SQLite, it must have
a proper backend architecture for all management operations.

Implement the necessary REST API endpoints and database fields or
configuration tables to support:

-   Visibility status
-   Active status
-   Display order
-   Featured status
-   Navigation visibility
-   Dashboard visibility
-   Search visibility where applicable

Keep these settings separate from the original manufacturer technical
data wherever practical.

For example, hiding a parameter must never modify its original technical
value, evidence, or verification status.

The frontend Admin Panel must communicate with the backend API. Do not
implement management settings only in React state or browser storage.

### 24.5 Authentication

Secure authentication and multi-user support are mandatory core
requirements from the initial architecture.

Implement local user accounts, secure login/logout, server-side
sessions, password hashing, and role-based access control. Do not
require a paid or external authentication provider.

The application must remain locally hosted and use the existing Node.js,
Express, and SQLite architecture. Authentication must be enforced by
backend middleware, not merely by frontend route guards.

Follow Section 30 for the complete multi-user, account, ownership,
storage-isolation, and administration requirements.

------------------------------------------------------------------------

## 25. REUSABLE DOCUMENT INGESTION SERVICE FOR FUTURE CLAUDE CODE SKILL

This requirement is important for future document-processing automation.

I may create a separate Claude Code Skill in the future to process newly
added VFD manuals.

Do not assume that the Skill must be created during the current
development phase.

Instead, build the application's document-processing functionality in a
reusable and callable architecture so that a future Claude Code Skill
can invoke it without requiring changes to the core ingestion system.

### 25.1 Intended Future Workflow

The future workflow should be:

1.  I manually place a new manual inside the existing `vfd-manuals/`
    directory.
2.  I invoke a Claude Code Skill and provide the selected document path
    as an argument.
3.  The Skill calls the application's existing document-ingestion
    interface.
4.  The application processes the selected manual using the same
    ingestion pipeline used by the normal UI.
5.  The extracted technical information is compared with existing
    brands, models, manuals, parameters, and Modbus records.
6.  The application identifies duplicates, missing information, and
    possible documentation conflicts.
7.  Extracted records are presented for review and verification.
8.  Approved information is integrated into the existing unified
    Knowledge Base and the same SQLite database.

Example future command:

`/process-vfd-manual vfd-manuals/Delta/New-Manual.pdf`

This is an example of the future Skill workflow, not a requirement to
build the Skill now.

### 25.2 Reusable Backend Service

Implement a reusable service, such as:

`DocumentIngestionService`

This service must be independent of the frontend UI.

Both the existing document-import interface and future external callers
must use this same service.

Do not create separate or duplicated document-processing pipelines.

The service should handle:

-   File validation
-   Brand and model identification
-   PDF and image processing
-   OCR
-   Text and table extraction
-   Technical parameter extraction
-   Modbus register extraction
-   Source and page-reference extraction
-   Duplicate detection
-   Existing-record comparison
-   Conflict detection
-   Verification workflow
-   Import job tracking
-   Database integration

### 25.3 Callable Interface

Provide a stable interface that a future Claude Code Skill can call.

Prefer a local CLI command, and optionally provide a suitable local REST
API endpoint.

Example CLI:

`npm run import:manual -- "vfd-manuals/Delta/New-Manual.pdf"`

The CLI must invoke the same `DocumentIngestionService` used by the
frontend.

It must accept an explicitly supplied document path.

It must NOT automatically watch or continuously scan the folder for new
files.

Only process the document explicitly selected by the user or the calling
Skill.

### 25.4 Validation and Safety

Before processing a document:

-   Verify that the file exists.
-   Verify that it is inside the permitted `vfd-manuals/` directory.
-   Validate the file format.
-   Detect duplicate files using a reliable file hash.
-   Detect whether the file is still being copied or is incomplete.
-   Identify whether the document has already been imported.

Never overwrite an existing verified record automatically.

When a new manual contains conflicting information, preserve the
existing record and create a review task.

Keep all original evidence and source references intact.

### 25.5 Preview and Structured Results

Support a preview or dry-run mode where practical.

The processing interface should return a structured, machine-readable
result, preferably JSON.

The result should include:

-   Import Job ID
-   Document name and path
-   Detected brand and model
-   Processing status
-   Number of pages processed
-   OCR status
-   Extracted parameter count
-   Extracted Modbus register count
-   Duplicate information
-   Potential conflicts
-   Verification status
-   Pending review count
-   Errors and warnings

This structured result will allow a future Claude Code Skill to
understand what happened and present the outcome to me.

### 25.6 Unified Knowledge Base Integration

All approved records must be saved into the existing SQLite database:

`database/vfd-knowledge.db`

Do not create another database.

Do not create a separate knowledge base for newly imported manuals.

New information must use the same:

-   Brand and model relationships
-   Common technical function mappings
-   Parameter data model
-   Modbus register data model
-   Evidence records
-   Source references
-   Verification records
-   Document revision system

The new manual must be integrated into the existing multi-brand research
and comparison system.

### 25.7 Important Development Principle

Build and test the reusable document-ingestion service and its callable
interface during the initial application development.

The future Claude Code Skill should only need to:

1.  Receive a document path.
2.  Call the existing CLI or API.
3.  Interpret the structured result.
4.  Present the processing summary and pending review information.

Adding a new manual must not require changing the application's source
code or creating a new ingestion pipeline.

Do not build an automatic filesystem watcher.

Do not build the future Claude Code Skill unless explicitly requested.

------------------------------------------------------------------------

## 26. ADDITIONAL ACCEPTANCE CRITERIA

The application will also be considered successful only when:

### Admin & Content Management

-   I can manage content visibility from the frontend.
-   I can hide and restore brands, models, categories, parameters, and
    documents.
-   I can change display order without modifying source code.
-   Display settings persist in SQLite.
-   Hidden records are not deleted.
-   The Admin Panel communicates with the backend.
-   Secure authentication and multi-user support are implemented from
    the initial architecture.
-   Role-based access control and backend ownership checks are enforced.
-   Existing personal data is migrated to a designated initial owner
    account without data loss.
-   Admin monitoring reports real per-user activity and storage usage.

### Future Skill Compatibility

-   A reusable document-ingestion service exists.
-   The frontend and CLI use the same ingestion service.
-   A CLI command can process one explicitly supplied manual path.
-   A future Claude Code Skill can call the CLI or API.
-   No automatic filesystem watcher is required.
-   Duplicate detection and conflict handling work.
-   Human verification is preserved.
-   Approved records enter the same SQLite database and unified
    Knowledge Base.
-   Source evidence and document relationships remain intact.

## FINAL IMPLEMENTATION INSTRUCTION

Treat Sections 24--26 as additional requirements to the original
Sections 1--23.

Do not remove, weaken, or replace any existing requirement.

Integrate these additions into the existing architecture, database
schema, backend services, frontend navigation, development phases, and
testing plan.

Do not build a separate application, separate database, or separate
knowledge base.

Keep the entire application locally hosted, portable, modular, and
expandable.

Build the actual working functionality, not just UI mockups or
conceptual placeholders.

# 27. DYNAMIC DEEP RESEARCH URL & NESTED BOOKMARK MANAGEMENT

This feature is a core extension of the existing Deep Research Explorer.

IMPORTANT: This is NOT a conventional website URL bookmarking system.

The main purpose is to allow users to bookmark their exact research
position inside this application.

Whenever a user explores technical information step by step, the
application must dynamically generate a unique, persistent, navigable
URL representing the current research context.

The user must be able to save that exact research state as a bookmark
with any custom name and organize it inside an unlimited nested folder
structure.

## 27.1 Dynamic Research URL Generation

Every meaningful research navigation state must have its own URL.

For example, a user may navigate through:

VFD Knowledge Base → Modbus & RS485 → Delta → VFD-EL → Register Explorer
→ Specific Register Address → Register Purpose → Data Extraction →
Technical Explanation → Related Parameters → Original Manual Evidence

Each meaningful research level must generate or update a URL
representing the current location.

Example URL structures (illustrative only):

``` text
/research/modbus
/research/modbus/delta
/research/modbus/delta/vfd-el
/research/modbus/delta/vfd-el/registers
/research/modbus/delta/vfd-el/registers/{registerId}
/research/modbus/delta/vfd-el/registers/{registerId}/purpose
/research/modbus/delta/vfd-el/registers/{registerId}/explanation
/research/modbus/delta/vfd-el/registers/{registerId}/evidence
```

These are examples, not mandatory route names.

Choose a clean and scalable routing architecture.

Use stable database IDs or stable slugs rather than relying on temporary
frontend state or array indexes.

The URL must represent the actual research context, not merely the page
name.

## 27.2 Preserve the Exact Research State

When a user opens a research URL, the application must restore the
corresponding research context.

Depending on the current research level, the state may include:

-   Selected Brand
-   Selected VFD Model
-   Selected Category
-   Selected Subcategory
-   Selected Common Function
-   Selected Manufacturer Parameter
-   Selected Modbus Register
-   Original Register Address
-   Address Representation
-   Selected Technical Explanation
-   Research Depth / Explanation Level
-   Selected Source Document
-   Original Manual Page Reference
-   Selected Tab or Research Section
-   Relevant Filters
-   Other meaningful navigation context

The application must not rely exclusively on React component state or
browser memory.

The URL and persisted database relationships must be sufficient to
restore the intended research page after:

-   Browser refresh
-   Browser restart
-   Copying and opening the URL again
-   Navigating backward or forward
-   Opening the URL in another browser session on the same application
    installation

Do not create URLs that lead to a generic page and lose the actual
research context.

If a referenced record is deleted or unavailable, display a meaningful
message rather than silently opening an unrelated page.

## 27.3 Dynamic Research Navigation

Integrate dynamic URL routing with the existing:

-   Deep Research Explorer
-   Breadcrumb Navigation
-   Parameter Explorer
-   Modbus Register Explorer
-   Technical Explanation Viewer
-   Documentation Source Viewer
-   Original PDF Page Viewer

Whenever the user moves deeper into a research topic, the URL must
update appropriately.

Browser Back and Forward must work naturally.

Breadcrumb clicks must navigate to the corresponding earlier research
URL.

Do not create duplicate or unnecessary history entries for minor UI
interactions.

## 27.4 Save Current Research as Bookmark

Add a clear action inside the Deep Research Explorer:

**Save Research Bookmark**

When clicked, save the current research location and its complete
navigational context.

Allow the user to enter:

-   Custom Bookmark Name
-   Optional Description
-   Destination Folder
-   Optional Tags
-   Optional Personal Notes

The bookmark name must be completely customizable.

Examples:

-   Delta EL -- Register 2103H Explanation
-   Output Frequency Data Extraction
-   Siemens V20 -- Maximum Frequency
-   Modbus Address Conversion Research
-   Register Usage and Related Functions

Save the internal research URL and the associated research context.

Do not save only the visible page title.

The bookmark must reopen the exact research location.

Allow users to:

-   Save a new bookmark
-   Rename a bookmark
-   Edit its description
-   Move it to another folder
-   Duplicate a bookmark
-   Delete a bookmark
-   Open a bookmark
-   Copy its internal research URL
-   Mark it as Favorite

Prevent accidental duplicate bookmarks where practical, but allow
intentional bookmarks with different custom names.

## 27.5 Nested Bookmark Folder System

Implement a hierarchical folder management system similar to the folder
structure in Google Chrome Bookmarks.

The folder structure must support unlimited practical nesting depth.

Example:

``` text
Research Bookmarks
│
├── Delta
│   │
│   ├── VFD-EL
│   │   │
│   │   ├── Modbus
│   │   │   ├── Register Address
│   │   │   │   ├── Register Purpose
│   │   │   │   ├── Data Extraction
│   │   │   │   └── Technical Explanation
│   │   │   │
│   │   │   └── Communication Settings
│   │   │
│   │   └── Parameter Research
│   │
│   └── VFD-M
│       └── Modbus Research
│
├── Siemens
│   │
│   ├── SINAMICS V20
│   │   ├── Parameters
│   │   └── Communication
│   │
│   └── PLC Integration
│
├── Fuji
│
├── Yaskawa
│
└── General Technical Research
```

This is only an example.

The user must be able to create their own folder structure.

Required folder operations:

-   Create Folder
-   Create Subfolder
-   Rename Folder
-   Delete Folder
-   Move Folder
-   Reorder Folders
-   Expand / Collapse Folder
-   Move Bookmarks Between Folders
-   Drag and Drop Bookmarks
-   Drag and Drop Folders

Allow folders inside folders without a fixed nesting depth.

A folder may contain both bookmarks and child folders.

Brand-specific folders are organizational groups, not necessarily
database Brand records. Allow custom folders independently.

Deleting a folder must never silently delete all bookmarks inside it.

Before deleting a non-empty folder, provide an option to move its
contents to its parent folder or another selected folder.

## 27.6 Brand-Specific Bookmark Organization

Support brand-specific research bookmark organization.

A user should be able to create a root folder for a manufacturer and
organize its models and research topics beneath it.

For example:

``` text
Delta
  └── VFD-EL
      └── Modbus
          └── Register 2103H
              └── Detailed Explanation
```

When saving a bookmark from a Delta research page, make it easy to
select the Delta folder or one of its subfolders.

If the appropriate folder does not exist, allow the user to create it
without leaving the research page.

Brand and model associations should be stored separately from folder
names.

Do not assume that a folder name alone establishes a verified
manufacturer or model relationship.

## 27.7 Bookmark Explorer UI

Create a dedicated **Research Bookmarks** interface.

Use a tree-style sidebar or expandable folder explorer.

The main area should display the selected folder's bookmarks.

Provide:

-   Folder Tree
-   Bookmark List
-   Search
-   Favorites
-   Recently Saved
-   Recently Opened
-   Sort by Name
-   Sort by Date
-   Custom Display Order
-   Breadcrumbs for Folder Navigation

Display useful bookmark information:

-   Custom Name
-   Brand
-   Model
-   Research Topic
-   Research Depth
-   Short Description
-   Last Opened
-   Date Saved

Use a clean, modern technical research interface.

The user must be able to navigate the folder hierarchy quickly even when
hundreds of bookmarks exist.

## 27.8 Research Context and Source Traceability

Every saved research bookmark must preserve its relationship to the
underlying knowledge base.

For example, a bookmark for a Modbus register explanation should retain
references to:

-   Brand ID
-   Model ID
-   Register ID
-   Original Manufacturer Address
-   Related Technical Explanation
-   Related Parameter Records
-   Source Document ID
-   Source Page Reference
-   Relevant Evidence Records

If the technical explanation or source information is later updated, the
bookmark should continue pointing to the corresponding underlying
record.

Do not create duplicate technical records when saving bookmarks.

A bookmark is a saved navigation reference, not a copy of the technical
knowledge itself.

## 27.9 SQLite Database Architecture

Integrate the bookmark system into the existing SQLite database:

`database/vfd-knowledge.db`

Suggested tables:

``` text
research_bookmark_folders
research_bookmarks
research_bookmark_tags
research_bookmark_tag_relations
research_bookmark_history
```

Suggested folder fields:

-   Folder ID
-   Parent Folder ID (nullable)
-   Folder Name
-   Description
-   Display Order
-   Created At
-   Updated At

Suggested bookmark fields:

-   Bookmark ID
-   Custom Name
-   Description
-   Internal Research URL
-   Research Context / State Reference
-   Brand ID (nullable)
-   Model ID (nullable)
-   Research Topic ID (nullable)
-   Related Entity Type
-   Related Entity ID
-   Parent Folder ID (nullable)
-   Favorite Status
-   Display Order
-   Created At
-   Updated At
-   Last Opened At

Use proper foreign keys, indexes, and database migrations.

Support recursive folder queries and safe folder movement.

Prevent a folder from being moved into itself or one of its descendants.

Use transactions for folder and bookmark operations.

You may improve the schema if a more normalized design is appropriate.

Do not create a separate database.

## 27.10 Important Technical Requirements

-   Research URLs must be dynamically generated from actual research
    navigation.
-   URLs must remain stable across browser refreshes and application
    restarts.
-   Bookmarks must reopen the exact saved research context.
-   Nested folders must support unlimited practical hierarchy.
-   Bookmarks and folders must persist in SQLite.
-   Folder organization must be independent of the underlying technical
    knowledge records.
-   Deleting a bookmark must not delete its associated technical
    information.
-   Deleting a technical record must not silently redirect a bookmark to
    another record.
-   The system must support future expansion without redesigning the
    routing architecture.
-   Do not make external cloud bookmark synchronization mandatory.
-   Require authentication for all private user workspaces and protected
    administrative operations. Shared read-only technical knowledge may
    be accessible only according to the configured application access
    policy.

## 27.11 Acceptance Criteria

The feature is complete when:

1.  Navigating through Deep Research dynamically updates the internal
    URL.
2.  Different research levels have distinguishable URLs.
3.  Opening a URL restores the correct research context.
4.  Browser refresh and Back / Forward navigation work correctly.
5.  The user can save the current research location as a bookmark.
6.  The user can assign any custom bookmark name.
7.  The user can create folders and nested subfolders.
8.  The user can organize bookmarks under brand-specific folders.
9.  The user can create folders within folders without a fixed nesting
    depth.
10. The user can move, rename, reorder, and delete folders and
    bookmarks.
11. Bookmarks preserve links to their original technical records and
    source evidence.
12. All bookmark and folder information persists in the existing SQLite
    database.
13. No duplicate knowledge base or separate database is created.

Integrate this feature into the existing Deep Research Explorer,
database architecture, frontend navigation, and local application.

Do not implement this as a generic external website bookmarking tool.

**The primary goal is to bookmark an exact point in the technical
research journey and return to that same point instantly at any time.**

# 28. TEXT ANNOTATION, COMMENTS & HIGHLIGHTING SYSTEM

This feature must be integrated into the existing Deep Research
Explorer, Documentation Viewer, Technical Explanation Viewer, and
Dynamic Research URL system.

The purpose is to allow the user to select any relevant text displayed
in the application, attach a personal comment to that exact text, save
the annotation in SQLite, and highlight the selected text whenever the
corresponding research content is opened again.

This is NOT a generic note-taking system.

It is a persistent, text-specific annotation system connected to the
exact research URL, technical section, and underlying knowledge base
records.

## 28.1 Select Text and Add Comments

Allow users to select text directly from the frontend.

When text is selected, display a small contextual action menu:

-   Add Comment
-   Highlight
-   Copy
-   Cancel

When the user clicks **Add Comment**, open a compact comment editor.

Allow the user to:

-   Write a personal comment.
-   Save the comment.
-   Edit an existing comment.
-   Delete a comment.
-   Cancel the operation.

The selected text must be automatically associated with the comment.

The user must not need to manually copy and paste the selected text.

Allow multiple annotations and comments on the same research page.

## 28.2 Preserve Exact Text and Research Context

Every annotation must retain the exact location and context of the
selected text.

Store the following information:

-   Annotation ID
-   Original Selected Text
-   Associated Comment
-   Current Internal Research URL
-   Research Section ID
-   Research Topic ID (if applicable)
-   Brand ID (if applicable)
-   Model ID (if applicable)
-   Parameter ID (if applicable)
-   Modbus Register ID (if applicable)
-   Source Document ID (if applicable)
-   Source Page Reference (if applicable)
-   Text Position / Start Offset
-   Text Position / End Offset
-   Text Prefix
-   Text Suffix
-   Highlight Color
-   Created At
-   Updated At

The exact selected text must be preserved.

Use a reliable text-anchoring approach combining:

-   Exact selected text
-   Prefix and suffix context
-   Text offsets where appropriate
-   Stable section or content identifiers

Do not rely exclusively on character offsets because content may change
after an application update or document reprocessing.

If the original text changes, attempt to relocate the annotation using
its saved text and surrounding context.

If the exact location cannot be recovered reliably, mark the annotation
as requiring reattachment.

Never silently attach a comment to an unrelated sentence.

## 28.3 Highlighting System

Implement persistent text highlighting.

The user must be able to select a text range and apply a highlight
color.

Initial color options:

-   Yellow
-   Green
-   Blue
-   Pink
-   Orange
-   Purple

Allow the user to select a preferred default highlight color.

The highlight color must be saved in SQLite.

When the user revisits the corresponding research page, the previously
highlighted text must automatically appear with its saved color.

Provide a dedicated **Highlight Mode** toggle.

Behavior:

-   Highlight Mode ON: Display saved highlights and allow users to
    interact with annotations.
-   Highlight Mode OFF: Hide annotation highlight backgrounds while
    preserving the underlying text and comments.
-   Default behavior: Previously saved highlights should be visible by
    default, unless the user changes the preference.

The user must be able to change an existing highlight color without
recreating the annotation.

Highlight colors must remain visually readable in both light and dark
themes.

## 28.4 Comment Interaction UI

When the user clicks or hovers over a highlighted text range, display
its associated comment.

The interface should support:

-   Compact Comment Popover
-   View Full Comment
-   Edit Comment
-   Delete Comment
-   Change Highlight Color
-   Navigate to Associated Research Context

If multiple comments exist on the same text, display them in an
organized comment panel.

Do not permanently modify the original technical text or extracted
manual content to insert comments.

Render highlights as a frontend annotation layer.

The original technical content must remain unchanged.

## 28.5 Annotation Management Panel

Create a dedicated **My Annotations** section inside the application.

Allow users to browse all saved comments and highlights.

Provide:

-   All Annotations
-   Recent Annotations
-   Favorites (optional)
-   Search by Selected Text
-   Search by Comment Content
-   Filter by Brand
-   Filter by Model
-   Filter by Research Topic
-   Filter by Annotation Color
-   Filter by Source Document

Each annotation entry should display:

-   Selected Text
-   User Comment
-   Highlight Color
-   Brand / Model
-   Research Section
-   Date Created
-   Associated Research Location

Clicking an annotation must navigate directly to the corresponding
research URL and scroll to the annotated text when possible.

## 28.6 Integration with Dynamic Research URLs

Integrate this system with Section 27: Dynamic Deep Research URL &
Nested Bookmark Management.

Every annotation must retain its associated internal research URL and
stable research entity references.

Example:

``` text
/research/modbus/delta/vfd-el/registers/{registerId}/explanation
```

If a user selects a sentence on that page and adds a comment, the
annotation must remain linked to that research location.

When the user opens the same URL later:

1.  Load the original research content.
2.  Retrieve annotations associated with that content.
3.  Locate the saved text ranges.
4.  Restore their highlight colors.
5.  Make associated comments accessible.

If a page contains multiple annotations, restore all of them correctly.

If a bookmark opens a research location containing annotations, those
annotations must also appear.

Do not create duplicate research pages or duplicate technical records
for annotations.

## 28.7 Documentation and PDF Viewer Integration

Where technically supported, allow text selection and annotations in:

-   Extracted PDF text
-   Technical Explanation
-   Parameter Description
-   Modbus Register Explanation
-   Research Notes
-   Documentation Source Viewer

For the original PDF viewer, implement text selection and annotation
when the PDF rendering technology supports reliable text-layer
positioning.

If exact text selection is unavailable in a scanned PDF or image-only
page, provide an appropriate alternative, such as selecting text from
the OCR-extracted content or attaching a page-level note.

Never pretend that a scanned image contains a reliably selectable text
layer when it does not.

Preserve the relationship with the original document, page index,
printed page number (when verified), and source reference.

## 28.8 SQLite Database Architecture

Store annotations in the existing database:

`database/vfd-knowledge.db`

Suggested table:

`research_annotations`

Suggested fields:

-   id
-   selected_text
-   comment_text
-   research_url
-   research_context_type
-   research_context_id
-   section_id
-   brand_id
-   model_id
-   parameter_id
-   modbus_register_id
-   document_id
-   document_page_id
-   start_offset
-   end_offset
-   text_prefix
-   text_suffix
-   highlight_color
-   annotation_status
-   created_at
-   updated_at

Add additional fields or normalized tables if necessary.

Suggested annotation statuses:

-   Active
-   Requires Reattachment
-   Source Unavailable
-   Archived

Use appropriate foreign keys, indexes, validation, and database
migrations.

Do not create a separate database.

## 28.9 Data Integrity and Persistence

Important requirements:

-   Comments must persist after browser refresh.
-   Highlights must persist after browser restart.
-   Annotations must remain associated with their original research
    context.
-   Editing a comment must not change the selected technical text.
-   Deleting an annotation must not delete the underlying technical
    information.
-   Changing a highlight color must preserve the comment.
-   Updating a research explanation must not silently move annotations
    to unrelated text.
-   Missing source content must be reported clearly.
-   All annotation operations must use the existing backend API and
    SQLite database.

The annotation system must be multi-user from the initial
implementation. Every personal annotation, comment, highlight, and
attachment must have an authenticated owner and backend-enforced
ownership checks. Follow Section 30.

## 28.10 Acceptance Criteria

The feature is complete when:

1.  A user can select text directly from the frontend.
2.  The user can attach a personal comment to the selected text.
3.  The selected text, comment, URL, and research section are saved
    together.
4.  The user can choose a highlight color.
5.  Saved highlights automatically reappear when the corresponding
    content is reopened.
6.  Highlight Mode can be turned ON or OFF.
7.  Users can edit and delete their annotations.
8.  Multiple annotations can exist on the same page.
9.  An annotation can navigate back to its original research location.
10. Annotations remain persistent after refresh and application restart.
11. Annotations remain connected to their original technical records and
    source evidence.
12. Changes to source content do not silently attach annotations to
    unrelated text.
13. All data is stored in the existing SQLite database.

**Primary Goal: The user must be able to select any important technical
sentence, write a personal comment, highlight it with a chosen color,
and return to that exact annotated text whenever needed.**

## 28.11 Rich Comments: Image Attachments & Hyperlinks

Comments must support text, one or multiple user-uploaded image
attachments, and clickable hyperlinks.

### Comment Editor

Provide a compact editor with:

-   Comment text input.
-   Add Image / Upload Image.
-   Add Link with optional custom display text.
-   Preview attached images and links before saving.
-   Remove or replace an attachment before saving.
-   Save and Cancel actions.

Plain-text comments must remain fully supported. Images and links are
optional.

### Image Attachment Requirements

-   Support JPEG/JPG, PNG, and WebP images.
-   Allow one or multiple images per comment, subject to configurable
    file-count and file-size limits.
-   Show image previews and allow users to open an image at a larger
    size.
-   Allow authorized owners to add, replace, and remove their own
    attachments.
-   Validate actual file content and MIME type; do not trust filename
    extensions.
-   Generate safe internal filenames and optional thumbnails.
-   Store attachment files in the owning user's private storage
    directory, not as SQLite BLOBs.
-   Store attachment metadata and ownership relationships in SQLite.

Suggested storage pattern (the actual directory must include the
authenticated owner's immutable ID):

``` text
storage/users/user-{userId}/comment-attachments/{annotationId}/{attachmentId}.png
storage/users/user-{userId}/thumbnails/{attachmentId}.webp
```

Suggested `research_annotation_attachments` fields:

-   Attachment ID
-   Annotation ID
-   User ID
-   Original Filename
-   Stored Filename
-   Extension
-   MIME Type
-   File Size
-   Image Width and Height
-   Storage Path (internal only)
-   SHA-256 Hash
-   Thumbnail Path
-   Alt Text / Description
-   Created At
-   Updated At

### Hyperlink Requirements

-   Allow users to add a URL and optional custom display text.
-   Detect and render valid URLs as clickable links.
-   Validate allowed URL schemes; allow safe `https:` and `http:` links
    as appropriate.
-   Reject `javascript:`, `data:`, and other unsafe executable schemes.
-   Open external links in a new tab with appropriate `rel` protections.
-   Do not automatically fetch, download, or trust linked content.
-   Allow the comment owner to edit or remove their own links.

### Attachment Ownership & Preservation

-   Every attachment must belong to the same authenticated user who owns
    the parent comment, unless a separately authorized shared workflow
    explicitly permits otherwise.
-   Editing a comment must preserve its existing attachments unless the
    user explicitly removes them.
-   Removing one attachment must not delete the parent comment or
    unrelated attachments.
-   Deleting a personal comment must not delete original manufacturer
    manuals, official page images, or shared evidence assets.
-   If an attachment is recoverable through Trash/soft-delete, retain
    the file until the retention policy or explicit permanent deletion
    is applied.
-   Prevent path traversal, unauthorized file access, and exposure of
    physical filesystem paths.

### Research Context

Each comment and its attachments must retain the relevant annotation ID,
selected text, research URL, research section, brand/model,
parameter/register, and source document/page references when applicable.

When a user reopens a comment, show its complete text, images,
hyperlinks, and original research context.

A user-uploaded image is a personal comment attachment; it must not
automatically be treated as verified manufacturer evidence.

## 28.12 Independent Deletion, Trash, Restore & Permanent Removal

All user-created comments, annotations, highlights, and their personal
attachment metadata must be manageable and deletable from the frontend.
Provide clear, separate controls so the user understands exactly what
will be removed.

### Separate Actions

Provide distinct actions:

1.  **Delete Comment** --- deletes the comment and its annotation record
    according to the configured deletion policy.
2.  **Remove Highlight** --- removes only the visual highlight; it must
    not silently delete the comment.
3.  **Delete Complete Annotation** --- removes the complete user-created
    annotation, its comment, and its personal attachment relationships.
4.  **Remove Attachment** --- removes only the selected personal
    attachment.

A user must be able to delete their own content from the comment
popover, annotation detail view, and Annotation Management panel.
Administrators may perform these actions only when their permissions
explicitly allow it.

### Soft Delete and Permanent Delete

Use soft deletion by default to protect against accidental removal:

-   Store deletion state and timestamp, such as `deleted_at` and
    `deletion_status`.
-   Hide soft-deleted records from normal research views.
-   Provide a Trash / Recently Deleted area.
-   Allow the owner or explicitly authorized administrator to restore an
    item.
-   Provide a separate, clearly labeled **Permanently Delete** action
    with an explicit confirmation.
-   Permanent deletion must remove the selected personal record and its
    exclusively owned personal attachment files/metadata safely.
-   Do not permanently delete shared files or any official manufacturer
    documentation, source evidence, page images, or technical knowledge
    records.
-   Apply a configurable retention policy only if explicitly configured;
    do not silently purge recoverable items.

If the project owner explicitly chooses immediate permanent deletion for
a specific operation, execute it only after clear confirmation and
ownership/permission validation.

### Database & Audit Requirements

Extend the existing annotation schema using a safe, versioned migration.
Suggested fields include `deleted_at`, `deletion_status`,
`deleted_by_user_id`, and `restored_at`, as appropriate. Preserve stable
annotation and attachment IDs and maintain audit history for delete,
restore, and permanent-delete operations.

All deletion operations must be authorized and executed by the backend
using database transactions and safe filesystem cleanup. Never rely on
frontend-only deletion. Deleting one user's annotation must not affect
another user's content.

### Annotation Management UI

Provide a management view where users can:

-   Search and filter their comments and annotations.
-   Filter by brand, model, parameter, research topic, date, and status.
-   Open the original research location.
-   Edit comments.
-   Remove highlights independently.
-   Delete comments or complete annotations.
-   View Trash and restore recoverable items.
-   Permanently delete selected items after confirmation.

### Acceptance Criteria

1.  Every frontend-created comment can be deleted by its owner.
2.  Every frontend-created annotation can be deleted by its owner.
3.  A highlight can be removed without unintentionally deleting its
    comment.
4.  A comment can be deleted without deleting the underlying technical
    knowledge.
5.  Soft-deleted items can be restored.
6.  Permanent deletion removes only the selected personal data and
    exclusively owned attachment files.
7.  Attachments remain intact when a comment is edited unless explicitly
    removed.
8.  Unauthorized users cannot delete, restore, or permanently remove
    another user's data.
9.  Delete/restore operations persist after refresh and application
    restart.
10. Official manuals, source evidence, and shared technical records
    remain untouched.

**Primary Goal: Users must have clear, reliable control to create, edit,
delete, restore, and permanently remove their own comments, annotations,
highlights, and attachments without damaging shared technical knowledge
or another user's data.**

# 29. EXISTING DATA, REFERENCE & ANNOTATION PRESERVATION SYSTEM

This is a CRITICAL requirement for the entire application, especially
for future Claude Code development and Claude Skill-based document
ingestion.

The application will continuously receive new PDF manuals, revised
documentation, extracted technical information, and updated research
content.

During these operations, existing database records and user-created
references must NEVER be accidentally destroyed, replaced, disconnected,
or invalidated.

The system must guarantee backward compatibility and preserve all
existing relationships whenever new documentation is imported or
existing documents are reprocessed.

## 29.1 Core Preservation Principle

**Existing records must be preserved by default. New documentation must
be compared against existing records rather than replacing them.**

Never automatically:

-   Delete an existing technical record.
-   Delete and recreate an existing parameter or Modbus register.
-   Change an existing record's primary ID.
-   Replace existing source references.
-   Overwrite verified technical values.
-   Remove existing document revisions.
-   Break relationships between records.
-   Delete research bookmarks.
-   Delete saved comments or annotations.
-   Remove text highlights.
-   Change annotation ownership or context references.
-   Reset existing research history.
-   Rebuild the database in a way that destroys existing IDs or
    relationships.

A new PDF is an additional source of information, not permission to
replace the existing knowledge base.

## 29.2 Stable IDs and Permanent References

Every important database entity must have a stable, persistent
identifier.

This includes:

-   Brands
-   Models
-   Documents
-   Document Revisions
-   Document Pages
-   Parameters
-   Modbus Registers
-   Technical Explanations
-   Research Topics
-   Research Bookmarks
-   Bookmark Folders
-   Research Annotations
-   Evidence Records
-   Source References

Once an entity has been created and referenced by other records, its ID
must not change during ordinary updates, imports, reprocessing, or
application upgrades.

Do not use mutable text fields, display names, parameter descriptions,
file names, or document paths as the sole identity of a record.

Use stable database IDs and appropriate unique constraints.

If a record's name, description, source, or technical content changes,
update or version the relevant information without unnecessarily
changing its identity.

If two existing records are discovered to represent the same entity, do
not merge or delete them automatically. Create a duplicate-resolution
review task.

## 29.3 Document Versioning and Revision Preservation

Every imported manual must have a persistent document identity.

When a new PDF is imported:

1.  Calculate its file hash.
2.  Check whether the same file already exists.
3.  Identify whether it is an exact duplicate or a new revision.
4.  Preserve the original document record.
5.  Create a separate document revision when appropriate.
6.  Preserve the previous extracted text and source mappings.
7.  Link the new revision to the correct document identity only when
    that relationship is verified.

Never assume that a file with the same name is the same document.

Never assume that a file with a different name is a completely different
manual.

Use file hashes, manufacturer information, model information, document
metadata, revision information, and manual review where necessary.

Previous document revisions must remain accessible.

## 29.4 Safe Comparison Before Updating Existing Records

Before inserting or updating technical information, Claude or the
ingestion service must compare new extracted information with the
existing database.

For every matched record, identify:

-   Existing Record ID
-   Existing Technical Value
-   Existing Description
-   Existing Source Document
-   Existing Document Revision
-   Existing Source Page
-   Existing Verification Status
-   New Extracted Value
-   New Source Document
-   New Document Revision
-   New Source Page
-   Differences Between Old and New Information

Classify the comparison result:

-   Exact Match
-   New Information
-   Updated Information
-   Conflicting Information
-   Possible Duplicate
-   Uncertain Match
-   No Existing Record

Do not automatically treat a similar parameter name or register address
as proof that two records are identical.

Use verified manufacturer, model, parameter identity, register identity,
and relevant technical context to determine matches.

Uncertain matches must be sent for review.

## 29.5 Existing Record Update Policy

Apply the following rules:

**Case A: New information matches an existing record**

-   Preserve the existing record ID.
-   Preserve all existing relationships.
-   Add the new supporting evidence or source reference.
-   Keep the previous evidence history.
-   Do not create unnecessary duplicate technical records.

**Case B: New information adds details**

-   Preserve the existing record.
-   Add the new information as a new version or additional evidence.
-   Preserve the previous explanation and its source.
-   Maintain the relationship between the old and new versions.

**Case C: New information conflicts with existing information**

-   Preserve both values and their respective source references.
-   Mark the record as Documentation Conflict.
-   Create a verification task.
-   Do not automatically choose the new value.
-   Do not overwrite the previously verified value.

**Case D: New information appears to describe a different parameter or
register**

-   Create a separate record when its identity is established.
-   Do not merge it with an existing record merely because the names are
    similar.

**Case E: Matching is uncertain**

-   Preserve all existing records.
-   Store the extracted information as pending review.
-   Do not automatically modify existing relationships.

## 29.6 Research Bookmark Preservation

Integrate this requirement with Section 27.

Every research bookmark must retain its stable internal reference to the
intended research entity.

If a technical explanation, parameter, register, or document is updated:

-   Do not delete the bookmark.
-   Do not silently change its destination.
-   Preserve its folder hierarchy.
-   Preserve its custom name and notes.
-   Preserve its associated research context.
-   Keep its original target identifiable.

If the original content is no longer available, show a meaningful
warning and offer access to the available historical version where
possible.

Do not silently redirect a bookmark to a different register or unrelated
technical explanation.

## 29.7 Comment and Highlight Preservation

Integrate this requirement with Section 28.

All existing user-created annotations must remain protected during
document imports and content updates.

An annotation may contain:

-   Original Selected Text
-   User Comment
-   Highlight Color
-   Research URL
-   Research Section
-   Stable Content ID
-   Source Document ID
-   Document Revision ID
-   Source Page Reference
-   Text Prefix and Suffix
-   Text Position / Offsets

When new documentation changes an explanation or extracted text:

1.  Preserve the original annotation record and its ID.
2.  Preserve the user's comment.
3.  Preserve its original selected text.
4.  Preserve its original research context.
5.  Attempt to relocate the annotation using text anchoring.
6.  Use exact text, prefix, suffix, and stable content identifiers.
7.  If a reliable match is found, update the current anchor without
    destroying its historical anchor.
8.  If no reliable match is found, mark it as Requires Reattachment.
9.  Never attach the comment to unrelated text automatically.

The user must be able to access the original annotation context and
understand why its current highlight could not be restored.

A change in PDF revision must not automatically delete or rewrite
annotations associated with an older revision.

## 29.8 Source Reference and Evidence Integrity

Every existing source reference must remain traceable.

Do not replace an old source reference with a new source reference
without preserving its history.

Maintain the distinction between:

-   Original Source Reference
-   Current Source Reference
-   Historical Source Reference
-   New Supporting Evidence
-   Conflicting Evidence

If a document is reprocessed, preserve the original document identity
and revision relationships.

If the physical page index or extracted text changes between revisions,
store the new mapping separately.

Never assume that a page number in a newer PDF refers to the same
technical content as the same page number in an older PDF.

## 29.9 Database Migration and Schema Preservation

Future Claude Code development and Skill-based processing may introduce
new database fields, tables, indexes, or relationships.

All database schema changes must use versioned migrations.

Mandatory rules:

-   Never drop and recreate the production database to apply an update.
-   Never use destructive migrations without an explicit approved
    migration plan.
-   Preserve existing primary keys.
-   Preserve foreign-key relationships.
-   Preserve existing records and historical versions.
-   Add new fields using safe migration strategies.
-   Use transactions for migrations.
-   Validate foreign-key integrity after migrations.
-   Test migrations against a copy of the existing database.
-   Provide rollback or recovery procedures where feasible.

Do not reset the existing database during application upgrades.

Do not run destructive cleanup operations automatically.

## 29.10 Safe Import Workflow for Claude Code and Future Claude Skills

Any Claude Code workflow or future document-processing Skill must follow
this sequence:

**Step 1 --- Inspect**

Inspect the existing project structure, database schema, migration
history, and related records.

**Step 2 --- Backup**

Create a verified backup of the SQLite database before any operation
that could modify existing data.

Preserve the original backup separately from temporary processing files.

**Step 3 --- Identify**

Identify the new document, calculate its hash, determine its likely
brand/model, and identify its revision.

**Step 4 --- Extract**

Extract technical information into a staging area without modifying
approved production records.

**Step 5 --- Compare**

Compare the extracted information with existing technical records,
source references, document revisions, bookmarks, and annotations.

**Step 6 --- Generate a Change Report**

Produce a report showing:

-   New Records
-   Matched Existing Records
-   Proposed Updates
-   Conflicting Values
-   Possible Duplicates
-   New Source References
-   Affected Research Locations
-   Potentially Affected Annotations
-   Uncertain Relationships

**Step 7 --- Review**

Require appropriate human approval before applying changes that modify
existing verified information, entity relationships, or existing
references.

New independent records with no existing relationship may be imported
according to the normal approval workflow.

**Step 8 --- Apply Changes Safely**

Use database transactions and non-destructive update operations.

Preserve existing IDs and historical versions.

**Step 9 --- Validate**

Verify that:

-   All previous record IDs still exist.
-   All expected foreign-key relationships remain valid.
-   All existing bookmarks remain accessible.
-   All existing annotations remain available.
-   All source references remain traceable.
-   No unintended record deletions occurred.
-   No existing verified information was silently overwritten.

**Step 10 --- Report**

Provide a final import report explaining exactly what was added,
updated, preserved, flagged, or left pending review.

If validation fails, do not report successful completion. Roll back the
transaction where possible and use the verified backup recovery
procedure when necessary.

## 29.11 Protection Against Unintended Claude Code Changes

When Claude Code or a future Skill works on this project:

-   Do not rewrite existing database logic without first inspecting its
    impact.
-   Do not replace existing schema files blindly.
-   Do not recreate existing records to simplify implementation.
-   Do not rename database tables or fields without a migration.
-   Do not remove existing functionality while implementing new
    features.
-   Do not modify existing bookmark or annotation relationships
    unnecessarily.
-   Do not delete files or data simply because they appear unused.
-   Do not perform broad database cleanup without explicit approval.
-   Do not treat a new PDF import as authorization to rewrite the
    existing knowledge base.

Before modifying an existing module, inspect its dependencies and
identify which database entities and user-created references depend on
it.

## 29.12 Backup, Recovery and Audit History

Maintain reliable backup and recovery support.

Before significant imports, reprocessing operations, or database
migrations:

-   Create a consistent SQLite backup.
-   Verify that the backup can be read.
-   Record the backup timestamp.
-   Record the operation associated with the backup.
-   Keep an operation log.

Maintain an audit history for changes to existing technical records.

Where practical, record:

-   Entity ID
-   Operation Type
-   Previous Value
-   New Value
-   Source of Change
-   Import Job ID
-   Timestamp
-   Approval Status

Do not store sensitive credentials in audit logs.

The user must be able to inspect what changed and when.

## 29.13 Acceptance Criteria

This system is complete only when:

1.  Importing a new PDF does not delete existing records.
2.  Existing primary IDs remain stable.
3.  Existing verified information is not silently overwritten.
4.  Previous document revisions remain accessible.
5.  Existing source references remain traceable.
6.  Research bookmarks continue to point to their intended research
    locations.
7.  Existing comments and highlights remain preserved.
8.  Changed text does not cause comments to attach to unrelated content.
9.  Conflicting information is retained for verification.
10. Database schema changes use safe, versioned migrations.
11. Significant changes have verified backups and an audit trail.
12. Claude Code and future Skills follow the same non-destructive
    processing rules.
13. The final import report identifies all changes and unresolved
    issues.

**MOST IMPORTANT RULE: A new PDF, a new Claude Skill execution, or a
future application update must never silently destroy or invalidate the
user's previously established technical knowledge, research bookmarks,
source references, comments, or highlights. Existing user-created
references must be treated as protected data.**

# 30. MULTI-USER SYSTEM, AUTHENTICATION, USER DATA ISOLATION & ADMIN MONITORING

This is a mandatory core architectural requirement. The application must
support multiple independent users with secure authentication,
user-specific personal data, separate private file storage, and
centralized administration.

## 30.1 Authentication & Account Management

Implement:

-   User registration, controlled by an administrator setting.
-   Administrator-created user accounts.
-   Secure login and logout.
-   Secure password hashing using Argon2id or bcrypt with appropriate
    parameters.
-   Server-side session management with secure, HTTP-only, SameSite
    cookies.
-   Session expiry, revocation, and logout from active sessions.
-   Password change and a secure local/configured password-reset
    workflow.
-   Profile management.
-   Account activation, deactivation, and suspension.
-   Login history and failed-login tracking.
-   Rate limiting and protection against brute-force attempts.

Never store plain-text passwords, session secrets, or authentication
tokens in ordinary frontend localStorage or logs. Do not require a paid
external identity provider. Derive the current user identity from the
verified server-side session; never trust a user ID supplied by the
frontend as proof of identity.

## 30.2 Roles & Permissions

Implement backend-enforced role-based access control (RBAC). Initial
roles:

-   **Super Admin:** complete system administration, user management,
    configurable access to user data, quotas, activity monitoring, and
    system configuration.
-   **Admin:** permissions explicitly granted by the Super Admin; may
    manage selected users or inspect permitted metrics/content.
-   **Standard User:** access to shared knowledge according to policy
    and full control over their own personal workspace only.

Do not automatically grant every Admin unrestricted access to private
user content. Use explicit permissions for viewing, editing, exporting,
or deleting personal records. Record sensitive administrative access and
changes in the audit log.

## 30.3 User-Specific Backend Storage

Create a separate directory for each user, keyed by an immutable
internal User ID, for example:

``` text
storage/
├── users/
│   ├── user-{userId-1}/
│   │   ├── profile/
│   │   ├── uploads/
│   │   ├── media/
│   │   ├── annotation-images/
│   │   ├── comment-attachments/
│   │   ├── documents/
│   │   ├── thumbnails/
│   │   └── exports/
│   └── user-{userId-2}/
│       ├── profile/
│       ├── uploads/
│       ├── media/
│       ├── annotation-images/
│       ├── comment-attachments/
│       ├── documents/
│       ├── thumbnails/
│       └── exports/
├── manuals/
├── extracted-text/
├── page-images/
├── ocr-results/
└── system/
```

Use `storage/users/user-{immutableUserId}/` as the user's private root.
Never use a username or email as the permanent directory identity
because these can change.

Every personal upload, comment attachment, annotation image, user
document, thumbnail, and export must be stored under its owner's
directory. Validate ownership on every read, download, replace, or
delete operation. Prevent path traversal, symlink/path escape,
unauthorized directory listing, and physical path disclosure. Do not
construct paths from untrusted frontend input.

Original manufacturer manuals, shared official page images, and verified
global technical documentation remain in shared system-level storage. Do
not duplicate them into every user's directory unless an intentional
user-owned copy is created.

## 30.4 Shared SQLite Database with User Ownership

Continue using the existing portable SQLite database:

`database/vfd-knowledge.db`

Do not create one SQLite database per user. Keep one normalized database
and logically isolate personal records using immutable `user_id`
ownership relationships.

Add suitable tables, as needed:

``` text
users
user_profiles
user_roles
user_permissions
user_sessions
user_login_history
user_activity_logs
user_storage_usage
user_storage_limits
user_settings
user_uploads
user_exports
user_notifications
research_annotations
research_annotation_attachments
research_bookmark_folders
research_bookmarks
research_bookmark_history
```

Extend existing tables safely. Personal records must have appropriate
ownership fields, such as `user_id`, `created_by_user_id`,
`updated_by_user_id`, and `deleted_by_user_id`, where relevant. Add
foreign keys, indexes, uniqueness constraints, and composite indexes for
common user-scoped queries, such as `(user_id, created_at)` and
`(user_id, folder_id)`.

Never retrieve a private record by its ID alone without checking the
authenticated owner's ID or an explicitly authorized administrative
permission. Use parameterized SQL and ownership-scoped queries
throughout the backend.

## 30.5 Shared Technical Knowledge vs Private User Data

Keep the following as shared global data:

-   Manufacturer brands and VFD models.
-   Original manufacturer manuals and revisions.
-   Verified parameters and Modbus register records.
-   Official diagrams, tables, figures, and source references.
-   Verified technical explanations and common technical categories.

Keep the following user-specific and private by default:

-   Comments, annotations, and highlights.
-   Comment image attachments and personal uploads.
-   Personal bookmarks and bookmark folders.
-   Personal research notes and settings.
-   User-generated exports and activity history.

Do not duplicate the entire knowledge base for every user. A user's
personal annotations must not automatically appear in another user's
workspace.

## 30.6 Ownership of Comments, Annotations & Bookmarks

Integrate authentication with Sections 27 and 28. When a user creates
any comment, annotation, highlight, bookmark, folder, upload, or
attachment:

1.  Identify the authenticated user from the verified server-side
    session.
2.  Assign the correct immutable owner ID on the backend.
3.  Save the record and its relationships in the existing SQLite
    database.
4.  Store personal files in that owner's private directory.
5.  Display the record only to its owner and administrators with
    explicit permission.

Users may create, edit, delete, restore, and permanently delete their
own content according to Section 28.12. Editing or deleting one user's
records must never affect another user's data.

## 30.7 Admin User Monitoring Dashboard

Create a dedicated Admin User Management and Monitoring Dashboard. Show
only actual database- and filesystem-derived metrics; never fabricate or
hardcode counts.

### Overall User Overview

Display:

-   Total registered users.
-   Active, inactive, and suspended users.
-   Recently registered users.
-   Currently active sessions.
-   Last login information.

### Per-User Statistics

For each user, display:

-   User ID, username, display name, role, and account status.
-   Registration date and last login.
-   Login count and active session count.
-   Total comments, active comments, and deleted comments.
-   Total annotations and highlights.
-   Total bookmarks and bookmark folders.
-   Total uploaded files, images, and documents.
-   Total storage used.

### Storage Monitoring

Show per-user totals and breakdowns:

-   Total storage used.
-   Uploaded file size.
-   Image size.
-   Comment/annotation attachment size.
-   Document size.
-   Export size.
-   File count.
-   Configured quota, remaining quota, and usage percentage.

Calculate usage from authoritative file metadata and reconcile it
against actual filesystem sizes. Handle missing files, orphaned
metadata, and failed uploads visibly; do not silently report inaccurate
totals. Provide search, sorting, and filtering by user, status,
registration date, last login, storage usage, uploads, and comments.
Allow authorized administrators to open a detailed user usage profile.

## 30.8 User Management Controls

According to permissions, administrators must be able to create and edit
accounts, activate/deactivate/suspend accounts, change roles, configure
permissions, set storage limits, review permitted activity, revoke
sessions, initiate secure password resets, and export usage reports.

Deactivating an account must not delete its data. Account deletion must
be a separate explicit workflow with confirmation and a clear
retention/export decision. Preserve or export the user's data before
removal when required. Never cascade-delete shared manufacturer
knowledge or other users' records.

## 30.9 User Activity & Audit Logs

Record relevant events:

-   Login, logout, failed login, session revocation.
-   Password change and profile update.
-   Comment/annotation/highlight creation, editing, deletion,
    restoration, and permanent deletion.
-   File upload, download where policy requires, replacement, and
    deletion.
-   Bookmark/folder creation, editing, movement, and deletion.
-   Account status, role, permission, and quota changes.
-   Administrative access to private user content where applicable.

Store activity ID, user ID, event type, related entity type/ID,
timestamp, and minimal relevant metadata. Never log passwords, tokens,
session cookies, or secrets. Make logs searchable and filterable, and
protect them from ordinary-user modification.

## 30.10 Storage Quotas & Upload Management

Allow the Super Admin to configure per-user total storage quotas,
individual upload size limits, image size limits, allowed file types,
and file-count limits where appropriate.

Before each upload:

1.  Authenticate the user and authorize the operation.
2.  Validate the actual file type, MIME signature, extension, and size.
3.  Check the user's available quota.
4.  Generate a safe internal filename and resolve the user's private
    storage path.
5.  Store the file safely and record metadata in SQLite.
6.  Update or reliably recalculate storage usage.
7.  Handle partial failures so database metadata and filesystem state do
    not become inconsistent.

Reject uploads that exceed limits with a clear message. Never silently
overwrite or discard existing files.

## 30.11 Security & Isolation Requirements

Implement authentication middleware, authorization middleware, ownership
validation, secure session handling, password hashing, rate limiting,
input validation, file validation, path traversal protection, CSRF
protection where applicable, secure HTTP headers, and parameterized SQL
queries.

Protect against insecure direct object reference (IDOR). Every protected
API endpoint must verify authentication, role, and ownership on the
backend. A Standard User must not access another user's comments, files,
attachments, bookmarks, settings, or activity by changing a URL, request
body, or record ID. Bind the server only to the intended local/network
interface; do not expose the application to a wider network without
deliberate configuration and security review.

## 30.12 Future Expansion

Support multiple users working independently, centralized
administration, per-user storage, usage quotas, and monitoring while
retaining the current SQLite architecture. Keep the data-access layer
modular so a future database migration is possible, but do not introduce
MySQL, PostgreSQL, MongoDB, or mandatory cloud infrastructure now.

## 30.13 Safe Migration of Existing Data

Before implementing multi-user support:

1.  Inspect the existing SQLite schema and all personal-data tables.
2.  Create and verify a consistent database backup and file-storage
    backup.
3.  Design a versioned, transactional migration.
4.  Create the initial Super Admin and a designated initial owner
    account as appropriate.
5.  Assign all pre-existing personal comments, annotations, bookmarks,
    folders, and attachments to the designated initial owner.
6.  Preserve all existing IDs, file paths, attachment relationships,
    source references, bookmarks, and annotation anchors.
7.  Do not assign existing private data to arbitrary new users.
8.  Validate ownership mappings, foreign keys, file existence, and
    record counts before completing migration.

Do not reset, recreate, or destructively rebuild the database. Use a
rollback plan and verify restore from backup.

## 30.14 Acceptance Criteria

1.  Multiple users can be created and securely authenticated.
2.  Every user has a unique immutable User ID.
3.  Every user has a separate private backend storage directory.
4.  Personal files are physically stored under the correct user
    directory.
5.  Personal database records have correct ownership relationships.
6.  Users cannot access another user's private data, even by
    manipulating API IDs.
7.  Users can manage their own comments, annotations, highlights,
    bookmarks, folders, and uploads.
8.  The Super Admin can monitor actual per-user activity and storage
    usage.
9.  Admin permissions are explicit and enforced by the backend.
10. Storage quotas and upload validation work correctly.
11. Account deactivation does not delete user data.
12. Existing personal data is migrated to the initial owner without
    loss.
13. Shared manufacturer documentation and verified technical records
    remain shared and intact.
14. The application continues using the existing SQLite database with
    safe migrations.
15. User ownership and file relationships survive restart, backup, and
    restore.

**PRIMARY OBJECTIVE: Every user must have an independent, secure
personal workspace, while the Super Admin retains centralized,
permission-controlled administration and can monitor each user's
accounts, activity, comments, uploads, and storage usage.**

# 31. FULL-WIDTH RESEARCH WORKSPACE, LARGE-DISPLAY SUPPORT & OPTIONAL SPLIT VIEW

This section is mandatory for the Deep Research Explorer and
documentation research experience.

## 31.1 Full-Width Research Layout

On large displays, including screens approximately 2500 pixels wide and
wider, the research workspace must use the full available viewport
width.

-   Use a fluid layout such as `width: 100%` / `width: 100vw` where
    appropriate.
-   Do not apply a restrictive global `max-width` to the main research
    workspace.
-   Do not center a narrow fixed-width research container while leaving
    large unused side margins.
-   Allow comparison tables, technical diagrams, register tables, and
    PDF/page viewers to expand across the available width.
-   Keep sensible internal padding and typography line lengths for
    paragraphs; full-width layout does not mean stretching every
    sentence across the entire screen.
-   Use responsive breakpoints so the workspace remains usable on
    laptops, tablets, and smaller screens.
-   Keep compact forms, dialogs, and settings panels appropriately
    sized; the full-width rule applies to the primary research
    workspace.

## 31.2 Optional Split View

Provide an optional Split View mode for research tasks that benefit from
viewing two related areas simultaneously.

Useful examples:

-   Technical explanation on one side and original manufacturer manual
    page on the other.
-   Parameter details beside its source table or figure.
-   Modbus register explanation beside the original register table.
-   Two related research topics or two model-specific records side by
    side.

Requirements:

-   Provide a clear Split View ON/OFF control.
-   Allow the user to choose the content shown in each pane.
-   Support adjustable/resizable pane widths with a draggable divider.
-   Provide sensible default proportions, but do not force a fixed
    ratio.
-   Allow either pane to expand or collapse when appropriate.
-   Preserve the current research context and dynamic URL behavior.
-   Ensure browser Back/Forward and breadcrumbs continue to work
    predictably.
-   Avoid duplicate or conflicting navigation state between panes.
-   On narrow screens, stack panes vertically or switch to a single-pane
    layout.
-   Provide clear pane titles and independent scrolling where useful.

## 31.3 Remember User Layout Preferences

Persist split-view enabled/disabled state, pane proportions, and
relevant workspace layout preferences per authenticated user. Provide
sensible defaults for a new user. Do not store personal layout
preferences as shared global technical data. If a user is not
authenticated during an explicitly permitted public view, use a
temporary session preference without mixing it into another user's
settings.

## 31.4 Manufacturer Graphics Must Be First-Class Research Evidence

When a research result relates to graphical material in a manufacturer
manual, show the relevant original graphical content together with the
explanation and source reference.

Include, where present and relevant:

-   Wiring diagrams and terminal connection diagrams.
-   Block diagrams and control architecture diagrams.
-   Parameter tables and Modbus register tables.
-   Timing charts and characteristic curves.
-   Flowcharts and sequence diagrams.
-   Figures, illustrations, and page screenshots.

Requirements:

-   Preserve and display the original manufacturer figure or page image,
    not merely OCR text.
-   Display the manual name/revision and verified page/figure/table
    reference beside the image.
-   Allow opening the full original page or PDF at the relevant
    location.
-   Keep extracted OCR text searchable, but never treat OCR text as a
    substitute for the original diagram or table when the graphic
    carries essential meaning.
-   Maintain image quality sufficient to read labels, terminal names,
    addresses, and values; allow zoom/pan for detailed figures.
-   Keep the original image and its evidence relationship intact across
    imports and document revisions.
-   Do not crop away relevant labels, notes, warnings, or surrounding
    context.
-   Do not use an AI-generated diagram as a replacement for an official
    manufacturer diagram.

If an AI-generated explanatory diagram is useful, label it clearly as
**AI-generated explanatory diagram** and display it separately from the
**Original Manufacturer Diagram**. AI-generated visuals must not be
represented as manufacturer evidence and must not introduce unsupported
technical facts.

## 31.5 Combined Research Presentation

When applicable, present the following together in the research
workspace:

1.  Research question or selected technical function.
2.  Verified explanation and relevant parameter/register details.
3.  Relevant original manufacturer diagram, table, chart, or page image.
4.  Source document name, revision, page number, and figure/table
    identifier.
5.  Extracted text and evidence classification.
6.  Related parameters, registers, or cross-references.

Use the full available width intelligently. Split View should be
available when the user needs to compare explanation and source evidence
without repeatedly switching pages.

## 31.6 Acceptance Criteria

1.  The main research workspace uses the full available width on a
    2500px-wide display and does not have an arbitrary narrow maximum
    width.
2.  Wide comparison and technical tables can use available horizontal
    space.
3.  Split View can be enabled and disabled.
4.  Split panes can be resized by the user.
5.  Split View works with research navigation, URLs, breadcrumbs, and
    browser history.
6.  Layout preferences persist independently for each authenticated
    user.
7.  Relevant original manufacturer diagrams, tables, charts, and page
    images appear alongside research explanations.
8.  Original graphical evidence includes verified source and page
    references.
9.  OCR text does not replace essential original graphical evidence.
10. AI-generated explanatory diagrams, if any, are clearly labeled and
    separated from manufacturer originals.

**PRIMARY OBJECTIVE: Make the research workspace spacious and efficient
on very wide monitors, while allowing users to inspect technical
explanations and original manufacturer evidence side by side whenever
that improves research.**

------------------------------------------------------------------------

# 32. DEFINITIVE MULTI-USER AUTHENTICATION, REGISTRATION & ROLE RULES

This section clarifies and overrides any older or conflicting
authentication, role, registration, or account-management wording in
earlier sections. Implement these rules as the definitive multi-user
policy.

## 32.1 Exactly Two Roles

The application must have exactly these two roles:

1.  **Super Admin**
2.  **Normal User**

There must be no separate `Admin`, `Administrator`, moderator, editor,
or other elevated role. Remove obsolete role names from enums, database
constraints, UI labels, authorization logic, documentation, and tests. A
Super Admin may perform centralized account and system administration. A
Normal User may use the knowledge base and manage only their own
user-owned content, subject to public/private visibility rules.

Role assignment must be enforced by the backend. A user must never be
able to choose or submit `Super Admin` during registration or promote
themselves by editing a request, URL, browser state, or database-facing
payload. New registrations always receive `Normal User`.

## 32.2 Frontend Registration Form

Provide a polished registration page with these fields:

-   Email address --- required.
-   Password --- required.
-   Confirm Password --- required and shown as a separate input.
-   Phone number --- optional.
-   Current Company --- optional.
-   Designation --- optional.

Requirements:

-   Validate required fields and password confirmation in the frontend
    for usability and again on the backend for security.
-   The password and confirmation must match exactly before registration
    is accepted.
-   Normalize and validate email addresses; enforce a database-level
    unique constraint using a clearly defined normalized email value.
-   Validate phone format when supplied, without requiring a phone
    number.
-   Validate password strength on the server and provide understandable
    feedback.
-   Never store plaintext passwords. Prefer Argon2id; bcrypt is
    acceptable if implemented with an appropriate work factor.
-   Do not expose whether an existing email belongs to another user in a
    way that enables account enumeration; use a considered error
    response.
-   Do not require Super Admin approval for a normal registration.
-   After successful registration, create a secure authenticated session
    and log the new user in immediately. Do not require a second login
    step.
-   New accounts are enabled by default and have the `Normal User` role.
-   Registration is enabled by default. Provide a Super Admin setting to
    enable or disable new registrations. When disabled, reject new
    registration attempts safely while existing users can still log in.
-   Profile fields may be edited later by their owner, subject to
    validation. Only the Super Admin controls account enable/disable
    status and role.

## 32.3 Registration Endpoint Abuse Protection

Protect the registration endpoint with a server-side, IP-based rate
limiter.

-   Default limit: no more than **3 registration requests per IP address
    per 1-hour window**.
-   Make the maximum request count and time window configurable through
    environment variables, for example:

``` env
REGISTRATION_RATE_LIMIT_MAX=3
REGISTRATION_RATE_LIMIT_WINDOW_MINUTES=60
```

-   Apply the limit to both successful and failed registration attempts.
    Count requests that reach the registration endpoint, not only
    successfully created accounts.
-   Return HTTP `429 Too Many Requests` after the limit is exceeded,
    with a clear retry-later message and appropriate retry information
    where practical.
-   Enforce the limit on the backend. Frontend-only throttling is not
    security.
-   Persist limiter state locally using SQLite or another robust local
    mechanism so restarting the application does not trivially reset the
    limit. Do not require Redis, a cloud service, or external
    infrastructure.
-   Determine the client IP safely. If the app is behind a reverse
    proxy, trust forwarding headers only from explicitly configured
    trusted proxies. Never blindly trust arbitrary `X-Forwarded-For`
    values supplied by clients.
-   Keep registration throttling separate from login, password-reset,
    and general API rate limits. Those endpoints require their own
    appropriate protections.
-   CAPTCHA, email verification, and additional anti-abuse mechanisms
    may be added later as optional defenses, but must not be mandatory
    dependencies for the initial implementation unless separately
    requested.

## 32.4 Initial Super Admin Bootstrap

Create the initial Super Admin through an idempotent database seed or
migration.

-   Use the previously specified Super Admin email from the project
    requirements.
-   Read the initial password from an environment variable such as
    `INITIAL_SUPERADMIN_PASSWORD`; never hardcode the password in source
    code, prompts, logs, test fixtures, or documentation.
-   Store only a secure password hash.
-   Create the bootstrap account only when no Super Admin exists.
    Re-running setup must never reset or overwrite an existing Super
    Admin password or account.
-   Require a password change at first login using a
    `must_change_password` or equivalent flag.
-   Do not expose bootstrap credentials in the UI, API responses, logs,
    or audit records.
-   Prevent accidental disabling or remote logout of the last active
    Super Admin. Require an explicit safe recovery path before allowing
    any operation that could leave the application without a Super
    Admin.

------------------------------------------------------------------------

# 33. SESSION LIFETIME, PERSISTENCE & SECURE SESSION REVOCATION

This section overrides any earlier default session-duration statements.

## 33.1 Seven-Day Default Session

The default authenticated session lifetime must be **7 days**. Configure
it through `.env`:

``` env
SESSION_TTL_DAYS=7
```

If the Super Admin or system operator changes the value to `14`, newly
created sessions must use a 14-day lifetime. Do not hardcode the
duration in application logic.

-   Use the same configured value to calculate both the browser cookie
    expiration and the server-side session `expires_at` timestamp.
-   Use a persistent cookie so closing and reopening the browser does
    not log the user out while the session remains valid.
-   Expired sessions must be rejected automatically.
-   Define clearly whether a configuration change affects only newly
    created sessions or also recalculates existing sessions; default to
    preserving each existing session's stored expiry unless an explicit
    administrative policy says otherwise.

## 33.2 Persistent Server-Side Sessions

Store sessions persistently in the existing SQLite database. Do not use
in-memory-only session storage and do not require Redis or a cloud
session store.

A valid session must survive a normal application/server restart,
provided its expiry time has not passed and it has not been revoked.

Store fields such as:

-   Session ID or a secure hash of the session token.
-   `user_id`.
-   `created_at`.
-   `expires_at`.
-   `last_seen_at`.
-   `revoked_at`.
-   `revoke_reason`.
-   Minimal user-agent/device metadata for session identification.

Never store raw bearer tokens or session secrets in readable database
fields or logs. Use cryptographically secure random session
identifiers/tokens and store only a safe hash or equivalent protected
representation where applicable.

## 33.3 Cookie & Session Security

-   Use `HttpOnly` cookies.
-   Use an appropriate `SameSite` policy.
-   Set `Secure` in HTTPS deployments.
-   Protect state-changing requests against CSRF where applicable.
-   Rotate the session identifier after login and privilege changes.
-   Apply login rate limiting and progressive backoff against repeated
    failures.
-   Do not place session tokens in URLs, browser local storage, logs, or
    analytics events.
-   Enforce account enabled status, session expiry, and revocation on
    every protected API request.
-   Enforce the same checks during Socket.IO handshakes and for
    privileged socket events.

## 33.4 Immediate Session Revocation

When a user logs out normally, a Super Admin remotely logs out a
session, or an account is disabled:

1.  Mark the relevant server-side session as revoked in SQLite.
2.  Reject subsequent API requests using that session.
3.  Notify connected client(s) where possible.
4.  Disconnect the affected socket connection(s).
5.  Clear client-side authentication state.
6.  Redirect the affected browser to the login page with a suitable
    message.

The backend database state is authoritative. A client-side redirect or
socket event alone is not sufficient to revoke a session.

------------------------------------------------------------------------

# 34. REAL-TIME USER PRESENCE, SUPER ADMIN MONITORING & REMOTE ACCOUNT CONTROL

## 34.1 Real-Time Presence with Socket.IO

Use Socket.IO or an equivalent authenticated WebSocket implementation
for real-time presence and administrative monitoring.

The Super Admin dashboard must show:

-   The number of currently connected authenticated users.
-   The number of unique users currently online.
-   The number of active authenticated sessions.
-   The number of active socket connections.
-   A live list of connected users and their relevant session/device
    details.
-   Connected-since and last-activity/heartbeat information.
-   Per-user counts of active sessions and socket connections.

Do not treat these counts as interchangeable. One user may have several
browser tabs, devices, sessions, or socket connections. Label each
metric accurately so the dashboard does not misrepresent the number of
people online.

## 34.2 Socket Authentication & Presence Accuracy

-   Authenticate each socket handshake using the same trusted
    server-side session mechanism as the web application.
-   Derive the user identity from the verified session on the server.
    Never trust a `user_id`, role, or account status supplied by the
    socket client.
-   Reject unauthenticated, expired, revoked, or disabled-account
    connections.
-   Recheck session validity and account status for privileged socket
    events, not only at initial connection.
-   Track connect, disconnect, reconnect, heartbeat, and last-seen
    events.
-   Expire stale presence records when a client disappears without a
    clean disconnect.
-   Reconcile live socket state with persistent session state so a stale
    socket cannot appear online indefinitely.
-   Only the Super Admin may access global user-presence data and
    monitoring controls. Normal Users must not receive global presence
    lists or administrative monitoring events.

## 34.3 Super Admin Remote Logout

The Super Admin must be able to remotely log out:

-   A selected session/device for a user; or
-   All active sessions for a selected user.

Show enough non-secret session metadata to help the Super Admin choose
the correct session, such as device/browser description, created time,
last activity, and connection status. Never display session tokens or
secrets.

Remote logout must revoke the server-side session, notify and disconnect
its sockets, clear the affected client's authentication state, and
reject all subsequent requests using that session. If the user has
multiple sessions, revoking one session must not accidentally revoke the
others unless the Super Admin selected the all-sessions action.

## 34.4 Enable & Disable User Accounts

The Super Admin must be able to enable or disable any Normal User
account at any time.

When an account is disabled:

-   Immediately mark the account disabled in the database.
-   Revoke all active sessions for that account.
-   Disconnect all associated socket connections.
-   Reject future login attempts.
-   Reject all subsequent API and socket operations, including requests
    from sessions that were established before disablement.
-   Preserve the user's comments, annotations, highlights, bookmarks,
    attachments, and other data. Disabling an account must never delete
    user data.

When an account is enabled again, the user may log in and create a new
session. Previously revoked sessions must not be restored automatically.

## 34.5 Administrative Audit Trail

Record account enable/disable, remote logout, all-session revocation,
and other privileged account actions with:

-   Acting Super Admin ID.
-   Target user ID and, where relevant, target session ID.
-   Action type.
-   Timestamp.
-   Optional administrative reason.
-   Minimal outcome metadata.

Never log passwords, session tokens, cookies, or other secrets. Protect
audit records from Normal User access and modification.

## 34.6 Monitoring & Remote-Control Acceptance Tests

Test at minimum:

1.  Live counts update when users connect and disconnect.
2.  Multiple tabs/devices for one user are counted as multiple
    connections but one unique online user.
3.  Session counts and socket counts are displayed separately.
4.  Stale connections eventually disappear from live presence.
5.  Normal Users cannot access monitoring APIs, socket events, or
    dashboards.
6.  Remote logout of one session does not revoke another session unless
    requested.
7.  Remote logout of all sessions revokes every session for that user.
8.  Disabling an account disconnects all sockets and blocks all APIs
    immediately.
9.  Re-enabling an account does not restore revoked sessions.
10. A disabled user cannot reconnect through Socket.IO or continue using
    an old browser session.
11. Server restart preserves valid unexpired sessions but does not
    restore revoked or expired sessions.
12. Audit events identify the acting Super Admin and target without
    exposing secrets.

------------------------------------------------------------------------

# 35. PUBLIC/PRIVATE CONTENT ACCESS & SHARED TEXT ANNOTATION ARCHITECTURE

This section is the definitive visibility and multi-user annotation
policy. It clarifies and overrides any older wording that treats all
user-created content as private-only or permits anonymous access to
public content.

## 35.1 Authentication Is Always Required

There must be no anonymous access to the application. A valid login is
required for every application page, API, Socket.IO connection, search
result, preview, metadata response, attachment, image, download, and
content endpoint.

In this application, **Public** means visible to any authenticated user
of this application. It never means visible to the unauthenticated
internet.

## 35.2 Public & Private Visibility

Comments, annotations, highlights, and their eligible attachments must
support independent `Public` and `Private` visibility.

-   Default visibility for every newly created user
    annotation/comment/highlight is `Private`.
-   **Private:** only the original owner may view the item.
-   **Public:** any authenticated application user may view the item,
    but other users receive read-only access.
-   Only the original owner may edit, delete, restore, permanently
    delete, change visibility, change its highlight color, or manage its
    attachments.
-   A Super Admin's monitoring privileges do not silently convert
    private content into public content. Any exceptional administrative
    access to private content must be explicitly permissioned and
    audited.
-   Changing an item from Public to Private must immediately revoke
    other users' access through APIs, open panels, search results,
    previews, and attachment routes.
-   Public-to-private changes must not rely on frontend hiding alone;
    every backend read must re-check visibility and ownership.
-   Do not leak the existence, author, count, color, timestamp,
    attachment metadata, or comment text of a Private item to other
    users.
-   Search indexes, result counts, autocomplete, notifications, and
    cached responses must apply the same visibility rules.

## 35.3 Shared Text Anchor + Independent User Annotations

Implement the architecture **Shared Text Anchor + Independent User
Annotations**.

When multiple users select or highlight the same exact text in the same
stable research context, the application may reuse a shared text anchor.
The anchor identifies the selected source text and location; it does not
represent shared ownership of user annotations.

A shared anchor should retain enough information to identify the exact
selection, such as:

-   Stable research content ID and canonical research URL/context.
-   Brand, model, parameter, register, document, document revision,
    page, and section IDs where applicable.
-   Exact selected text.
-   Start/end offsets when available.
-   Prefix and suffix context.
-   Stable source/content identifiers needed for safe re-anchoring.

Each user's annotation must be a separate record linked to the anchor,
with its own:

-   Immutable `user_id` owner.
-   Comment text.
-   Highlight color and highlight state.
-   Public/Private visibility.
-   Attachments.
-   Created/updated timestamps.
-   Soft-delete, restore, and permanent-delete state.

A suggested data structure is a shared `research_text_anchors` table and
separate `research_annotations` records referencing `anchor_id`. Adapt
the existing schema through safe migrations; do not destroy or recreate
existing annotation records.

## 35.4 Multiple Public Annotations on the Same Text

If User A and User B both make Public annotations on the same selected
text:

-   Show the underlying research text only once.
-   Preserve each user's highlight color and comment independently.
-   Do not overwrite one user's color with another user's color.
-   Do not merge the comments into one ownerless comment.
-   Use a clear combined visual treatment when multiple users highlight
    the same text, such as layered translucent colors, multi-color
    underline/edge markers, or a small multi-color indicator.
-   Make the treatment understandable and accessible; provide a legend
    or tooltip when needed.
-   Clicking or selecting the marked text should open an annotation
    panel listing all annotations the current user is allowed to see.
-   Each entry should identify its author, highlight color, comment,
    visibility where appropriate, and timestamp.
-   The owner may edit or delete only their own annotation. Editing,
    recoloring, hiding, or deleting User A's annotation must never alter
    User B's annotation.

Do not duplicate the source text in the page just because multiple
annotations refer to it.

## 35.5 Public/Private Isolation on a Shared Anchor

Visibility belongs to each independent annotation record, not to the
shared anchor as a whole.

For example, if User A has a Public annotation and User B has a Private
annotation on the same anchor:

-   User A may see their own annotation.
-   User B may see their own Private annotation and any Public
    annotation.
-   A third authenticated user may see only User A's Public annotation.
-   The third user must not learn that User B's Private annotation
    exists. Do not reveal a private count, hidden color, author,
    timestamp, or placeholder.

All annotation lists, popovers, counters, highlight overlays, search
results, and notifications must be visibility-aware.

## 35.6 Safe Anchor Matching & Re-Attachment

Reuse a shared anchor only when the selected text and stable content
context match safely. Do not group unrelated selections merely because
their visible words are similar.

-   Exact text plus stable content identity and anchor context should
    guide matching.
-   Partial overlaps, different selections, different document
    revisions, or ambiguous locations should remain separate anchors
    unless a safe, explicit relationship can be established.
-   When source content changes, attempt re-anchoring using stable IDs,
    exact text, prefix/suffix, and offsets.
-   If the correct location cannot be established confidently, mark the
    annotation `Requires Reattachment` and ask for review. Never
    silently attach a comment or highlight to unrelated text.
-   Preserve old document-revision anchors and annotations when a new
    manual revision is imported.

The original manufacturer manual, extracted technical content, and
verified knowledge-base records must remain immutable under user
annotation actions. An annotation is a user-created research note, not a
verified manufacturer technical fact.

## 35.7 Attachment Access

-   A Public annotation's explicitly attached files may be viewed only
    by authenticated users who can view that Public annotation.
-   A Private annotation's attachments are accessible only to its owner,
    subject to any explicitly audited Super Admin permission.
-   Attachment URLs must be protected by backend authorization;
    unguessable URLs alone are not authorization.
-   Do not expose private attachment filenames, paths, thumbnails,
    metadata, or download responses to unauthorized users.
-   Preserve existing file validation, owner-specific storage, path
    traversal protection, and safe deletion rules from earlier sections.

------------------------------------------------------------------------

# 36. PER-USER ANNOTATION DISPLAY PREFERENCES & NON-DISTRACTING SHOW/HIDE CONTROLS

Provide a small, unobtrusive display-settings control in the Deep
Research Explorer. Its purpose is to let each user reduce visual
distraction without changing the visibility or data of anyone's
annotations.

## 36.1 Header Control & Popover

Place a compact **Eye / Annotation Display** icon in a sensible location
in the Research Explorer header, preferably near the other research
tools on the right side. Do not add a large permanent settings panel or
consume valuable research workspace space.

When clicked, open a small, accessible popover titled
`Annotation Display Settings`. The icon may indicate whether annotations
are currently shown or hidden. Use clear Show/Hide labels or
checkboxes/toggle controls with accessible names; do not rely on icon
shape or color alone.

The popover should provide independent controls:

1.  **Other Users' Public Content** --- show/hide Public annotations,
    comments, and highlights created by other users.
2.  **My Own Content** --- show/hide the current user's own annotations,
    comments, and highlights, including the user's own Public and
    Private items.
3.  **Highlight Backgrounds** --- optionally show/hide only the visual
    highlight colors while keeping accessible comments/annotation
    entries available, if the user wants to read comments without
    colored marks.

If useful, allow separate finer controls for public comments and public
highlights, but keep the initial interface compact and understandable.
The essential requirement is that the user can independently hide other
users' Public content and their own content.

## 36.2 Display Preference Behavior

-   Default all display controls to Show for a new user.
-   Each control must operate independently. Hiding other users' Public
    content must not hide the user's own content, and vice versa.
-   Hiding a category changes only what the current user sees in their
    own frontend. It must not change the item's Public/Private
    visibility, owner, stored comment, color, attachment, or
    permissions.
-   Never update another user's settings when the current user changes a
    display preference.
-   Hidden content must remain stored and available to its owner when
    shown again.
-   Do not delete, soft-delete, archive, or modify annotation records
    when the user toggles display settings.
-   A display preference must never grant access to Private content. The
    visibility/authorization rules in Section 35 are always enforced
    before display preferences are applied.
-   If the user hides their own content, this is only a local display
    choice; it does not make their Public annotations Private for other
    users.
-   When a display category is hidden, do not leave misleading empty
    highlight markers or counts that reveal hidden/private content.

## 36.3 Persistence Per User

Persist these settings in SQLite, associated with the authenticated
immutable `user_id`, preferably through the existing `user_settings`
structure or a versioned preference table.

-   Preferences must survive browser refresh, logout/login, and
    application/server restart.
-   Preferences must remain independent across different user accounts
    and devices according to the account-level preference model.
-   If device-specific preferences are later introduced, define that
    behavior explicitly; do not accidentally mix one user's preferences
    with another user's settings.
-   Provide sensible defaults when no preference record exists.
-   Validate preference updates on the backend and prevent one user from
    modifying another user's preferences by changing a user ID in the
    request.

## 36.4 Non-Disruptive UX & Accessibility

-   Keep the control visually small and unobtrusive.
-   Open a compact popover rather than navigating away from the research
    page.
-   Close the popover predictably on Escape, outside click, or selection
    of a setting, while preserving keyboard accessibility.
-   Use clear labels, accessible focus states, screen-reader names, and
    adequate contrast.
-   Show the current state with a check mark, toggle, or eye/eye-off
    indicator and text label.
-   Do not use color as the only indication of state.
-   Do not obscure important technical text, diagrams, or navigation.
-   On narrow screens, keep the popover usable without covering the
    entire research experience.

## 36.5 Acceptance Tests

1.  A new user sees their own and other users' Public annotations by
    default.
2.  Hiding other users' Public content hides only those Public items
    from the current user's research view.
3.  Hiding the current user's own content hides only that user's items
    from their own view.
4.  The two primary controls work independently.
5.  Hiding highlight backgrounds does not delete highlights or comments.
6.  Changing display preferences does not change Public/Private
    visibility.
7.  Another user's display is unaffected by the current user's
    preference changes.
8.  Preferences survive refresh, logout/login, and server restart.
9.  A user cannot modify another user's preferences through a forged
    request.
10. Private content remains inaccessible regardless of display settings.
11. Hidden content does not leak through counters, search results,
    tooltips, popovers, or metadata.
12. The header control remains compact, accessible, and non-disruptive.

------------------------------------------------------------------------

# 37. FINAL IMPLEMENTATION PRIORITY & CONFLICT-RESOLUTION RULE

When implementing the application, treat Sections 32--36 as mandatory
clarifications and the definitive requirements for registration, roles,
sessions, live presence, remote account control, public/private
annotations, shared text anchors, and annotation display preferences.

If any earlier section conflicts with Sections 32--36:

1.  Follow Sections 32--36 for the specific topics they govern.
2.  Preserve all unrelated requirements and existing functionality from
    Sections 1--31.
3.  Do not remove earlier features merely because a later section
    clarifies their security or ownership model.
4.  Use versioned, non-destructive SQLite migrations and verified
    backups.
5.  Preserve all existing users' data, stable IDs, bookmarks, comments,
    annotations, highlights, attachments, document references, and
    source evidence.
6.  Before implementation, inspect the current codebase and database
    schema. Produce a short impact plan identifying affected routes,
    tables, components, socket events, migrations, and tests.
7.  Implement in small, verifiable stages. Do not claim a feature is
    complete until its backend authorization, frontend behavior,
    persistence, and acceptance tests have been verified.

**FINAL PRODUCT GOAL:** Build a locally hosted, secure, multi-user VFD
technical research platform in which verified manufacturer knowledge
remains protected, users can independently create and selectively share
annotations, each user controls their own annotation display experience,
and the Super Admin has accurate real-time presence and account-session
controls without compromising user-data isolation.
