# Revit API Developer Skill

This skill gives you deep knowledge of the Autodesk Revit API for building Revit plugins (add-ins) in C#. Reference this for code generation, debugging, migration advice, and architectural decisions.

---

## Platform & Version Overview

Revit API docs are versioned per Revit release year. Available versions: 2015, 2016, 2017.1, 2018.2, 2019, 2021.1, 2022, 2023, 2024, 2025, 2025.3, 2026.

**Why versions matter:** The API has breaking changes almost every year. Key platform shifts:
- **2022** — `ForgeTypeId` replaces `BuiltInParameterGroup`/`ParameterType` enums; `Floor.Create()` replaces `Document.NewFloor()`
- **2024** — `ElementId` upgraded from 32-bit to 64-bit; use `ElementId.Value` (Int64) not `.IntegerValue` (int)
- **2025** — Revit now runs on **.NET 8**; all add-ins must be retargeted to .NET 8
- **2026** — `ElementId(int)` constructor and `.IntegerValue` **hard removed**; add-in isolation manifest option added

Always ask which Revit version the user is targeting before generating plugin code.

---

## Assembly Structure

Revit API ships as two main assemblies:
- **RevitAPI.dll** — Core document/element model (`Autodesk.Revit.DB.*`)
- **RevitAPIUI.dll** — UI ribbon/commands/events (`Autodesk.Revit.UI.*`)

### Key Namespaces

| Namespace | Purpose |
|---|---|
| `Autodesk.Revit.DB` | Core: Document, Element, Parameter, Geometry, Transactions |
| `Autodesk.Revit.UI` | External commands, ribbon, task dialogs, selection |
| `Autodesk.Revit.DB.Architecture` | Rooms, stairs, railings, topography |
| `Autodesk.Revit.DB.Mechanical` | Ducts, spaces, HVAC zones, MEP connectors |
| `Autodesk.Revit.DB.Electrical` | Electrical systems, panels, wire types, circuits |
| `Autodesk.Revit.DB.Plumbing` | Pipes, pipe fittings, plumbing fixtures |
| `Autodesk.Revit.DB.Structure` | Structural framing, rebar, analytical models |
| `Autodesk.Revit.DB.Analysis` | Energy analysis, solar, lighting, view analysis |
| `Autodesk.Revit.DB.IFC` | IFC import/export options |
| `Autodesk.Revit.ApplicationServices` | Application, ControlledApplication |
| `Autodesk.Revit.Exceptions` | Revit-specific exception types |

---

## Plugin Entry Points

### IExternalCommand (most common)
For ribbon button commands. Implement in a class, decorate with `[Transaction(TransactionMode.Manual)]`.

```csharp
[Transaction(TransactionMode.Manual)]
public class MyCommand : IExternalCommand
{
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elements)
    {
        UIApplication uiApp = commandData.Application;
        UIDocument uiDoc = uiApp.ActiveUIDocument;
        Document doc = uiDoc.Document;

        using (Transaction tx = new Transaction(doc, "My Operation"))
        {
            tx.Start();
            // ... make changes ...
            tx.Commit();
        }
        return Result.Succeeded;
    }
}
```

Return values: `Result.Succeeded`, `Result.Failed`, `Result.Cancelled`.

### IExternalApplication
For startup/shutdown logic, ribbon creation. Fires when Revit loads.

```csharp
public class MyApp : IExternalApplication
{
    public Result OnStartup(UIControlledApplication application)
    {
        // Create ribbon panels, register updaters, etc.
        RibbonPanel panel = application.CreateRibbonPanel("My Plugin");
        PushButtonData btn = new PushButtonData("MyCmd", "Run",
            Assembly.GetExecutingAssembly().Location,
            typeof(MyCommand).FullName);
        panel.AddItem(btn);
        return Result.Succeeded;
    }

    public Result OnShutdown(UIControlledApplication application)
    {
        return Result.Succeeded;
    }
}
```

### IExternalDBApplication
For server-side/Revit Server scenarios without UI. Same pattern but receives `ControlledApplication` (not `UIControlledApplication`).

### .addin Manifest
Every plugin needs a `.addin` XML file in `%AppData%\Autodesk\Revit\Addins\<version>\`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<RevitAddIns>
  <AddIn Type="Application">
    <Name>My Plugin</Name>
    <Assembly>C:\path\to\MyPlugin.dll</Assembly>
    <AddInId>A1B2C3D4-...</AddInId>  <!-- unique GUID -->
    <FullClassName>MyNamespace.MyApp</FullClassName>
    <VendorId>MYCO</VendorId>
    <VendorDescription>My Company</VendorDescription>
  </AddIn>
  <AddIn Type="Command">
    <Name>My Command</Name>
    <Assembly>C:\path\to\MyPlugin.dll</Assembly>
    <AddInId>A1B2C3D4-...</AddInId>
    <FullClassName>MyNamespace.MyCommand</FullClassName>
    <VendorId>MYCO</VendorId>
  </AddIn>
</RevitAddIns>
```

For Revit 2026+, add `<UseRevitContext>False</UseRevitContext>` inside `<AddIn>` to opt into add-in isolation (recommended for new plugins).

---

## Transaction API

All model modifications **must** be wrapped in a Transaction. Revit enforces this — calling a modifying method outside a transaction throws `InvalidOperationException`.

```csharp
// Single transaction
using (Transaction tx = new Transaction(doc, "Description"))
{
    tx.Start();
    // modify doc
    tx.Commit(); // or tx.RollBack() on error
}

// Transaction group (multiple transactions as one undo step)
using (TransactionGroup tg = new TransactionGroup(doc, "Batch Operation"))
{
    tg.Start();
    using (Transaction tx1 = new Transaction(doc, "Step 1")) { tx1.Start(); /* ... */ tx1.Commit(); }
    using (Transaction tx2 = new Transaction(doc, "Step 2")) { tx2.Start(); /* ... */ tx2.Commit(); }
    tg.Assimilate(); // merges all into one undo entry
}

// SubTransaction (nested, inside a transaction)
using (SubTransaction sub = new SubTransaction(doc))
{
    sub.Start();
    // ... 
    sub.Commit();
}
```

**Transaction modes** (on the class attribute):
- `TransactionMode.Manual` — you manage transactions yourself (most flexible)
- `TransactionMode.Automatic` — Revit wraps each Execute() call (less control, not recommended)
- `TransactionMode.ReadOnly` — no modifications allowed (safe for queries)

---

## FilteredElementCollector

The primary way to query elements from the document. Always faster than iterating all elements manually.

```csharp
// Get all walls in document
var walls = new FilteredElementCollector(doc)
    .OfClass(typeof(Wall))
    .Cast<Wall>()
    .ToList();

var wallsInView = new FilteredElementCollector(doc, doc.ActiveView.Id)
    .OfClass(typeof(Wall))
    .Cast<Wall>()
    .ToList();

// Get by BuiltInCategory
var doors = new FilteredElementCollector(doc)
    .OfCategory(BuiltInCategory.OST_Doors)
    .WhereElementIsNotElementType()
    .ToElements();

// Combine filters (AND logic)
var filter = new LogicalAndFilter(
    new ElementClassFilter(typeof(FamilyInstance)),
    new ElementCategoryFilter(BuiltInCategory.OST_Furniture)
);
var furniture = new FilteredElementCollector(doc).WherePasses(filter).ToElements();

// Parameter-based filter (slow filter — use as secondary)
var highCostItems = new FilteredElementCollector(doc)
    .OfCategory(BuiltInCategory.OST_Furniture)
    .WhereElementIsNotElementType()
    .Where(e => e.LookupParameter("Cost")?.AsDouble() > 1000)
    .ToList();
```

**Performance rule:** Quick filters (class, category, BoundingBox) run natively in Revit's DB — use these first. Slow filters (LINQ `.Where()`) iterate in memory — add them last.

---

## Common Classes Reference

### Document & Application
| Class | Key Methods/Properties |
|---|---|
| `Document` | `ActiveView`, `GetElement(ElementId)`, `Delete(ElementId)`, `Regenerate()`, `PathName` |
| `UIDocument` | `ActiveView`, `Selection`, `PromptForFamilyInstancePlacement()`, `RequestViewChange()` |
| `UIApplication` | `ActiveUIDocument`, `Application`, `MainWindowHandle` |
| `Application` | `VersionNumber`, `VersionName`, `OpenDocumentFile()` |

### Elements
| Class | Notes |
|---|---|
| `Element` | Base class. `Id`, `Name`, `Category`, `LookupParameter()`, `GetParameters()` |
| `FamilyInstance` | Placed family. `Symbol`, `Host`, `Location`, `GetSubComponentIds()` |
| `FamilySymbol` | Family type. Must call `Activate()` before placing |
| `Wall` | `WallType`, `Height`, `Flipped`, `Orientation` |
| `Floor` | Created via `Floor.Create(doc, curveLoops, floorTypeId, levelId)` (2022+) |
| `Level` | `Elevation`, `ProjectElevation` |
| `View` | `ViewType`, `Scale`, `DetailLevel`, `SetCategoryHidden()`, `GetFilterIds()` |
| `ViewSchedule` | Schedule views; `GetTableData()`, `GetScheduleDefinition()` |

### Geometry
| Class | Notes |
|---|---|
| `XYZ` | 3D point/vector. Immutable. `X`, `Y`, `Z`, `DistanceTo()`, `Normalize()`, `CrossProduct()` |
| `Line` | `CreateBound()`, `CreateUnbound()`, `Direction`, `Length` |
| `Curve` | Base for Line, Arc, Ellipse, NurbSpline, HermiteSpline |
| `CurveLoop` | Closed loop of curves. `Create()`, `IsCounterclockwise()` |
| `Solid` | Geometry solid. `Faces`, `Edges`, `Volume`, `SurfaceArea` |
| `BoundingBoxXYZ` | `Min`, `Max` |
| `Transform` | Coordinate transform. `Identity`, `CreateTranslation()`, `BasisX/Y/Z`, `Origin` |

**Unit note:** Revit API uses **internal units (feet)**. Convert with `UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters)` (2021+) or `UnitUtils.Convert()` for older versions.

### Parameters
```csharp
// Read a parameter
Parameter p = element.LookupParameter("Comments");
if (p != null && !p.IsReadOnly)
{
    string val = p.AsString();
    double dbl = p.AsDouble();
    ElementId id = p.AsElementId();
    int integer = p.AsInteger();
}

// Write a parameter
p.Set("new value"); // string
p.Set(3.28084);     // double (internal units)

// By BuiltInParameter
Parameter mark = element.get_Parameter(BuiltInParameter.ALL_MODEL_MARK);
```

**2022+ ForgeTypeId pattern (preferred for new code):**
```csharp
// Instead of BuiltInParameterGroup
ForgeTypeId groupId = GroupTypeId.Geometry;
// Instead of ParameterType
ForgeTypeId specId = SpecTypeId.Length;
```

---

## Version Compatibility Strategy

For targeting multiple Revit versions in one codebase:

1. **Multi-targeting in .csproj** — use `<TargetFrameworks>net8.0;net48</TargetFrameworks>` with conditional references
2. **Conditional compilation** — `#if REVIT2024_OR_GREATER` symbols defined per build configuration
3. **Adapter pattern** — wrap version-sensitive APIs in a compatibility layer class
4. **Separate builds** — maintain separate solution configurations per major version (simplest for large breaks like the .NET 8 jump in 2025)

### ElementId migration (2024-2026)
```csharp
// Before 2024 (still works in 2024, removed in 2026)
int id = element.Id.IntegerValue;
new ElementId(42);

// 2024+ compatible (works in 2024, 2025, 2026)
long id = element.Id.Value;
new ElementId(42L);
```

---

## Common Patterns & Gotchas

- **Always check `doc.IsModifiable`** before starting a transaction in event handlers
- **Never store `Document` references** across Revit sessions; re-acquire from `UIApplication`
- **Family symbols must be activated** before `doc.Create.NewFamilyInstance()`: `symbol.Activate(); doc.Regenerate();`
- **`Regenerate()` after geometry changes** if subsequent reads depend on updated geometry
- **Use `IDisposable` pattern** on all Revit API objects that implement it (Transaction, etc.)
- **`FilteredElementCollector` is lazy** — call `.ToList()` or `.ToElements()` to materialize
- **Revit API is single-threaded** — never call API from background threads; use `ExternalEvent` for async UI scenarios
- **`PostCommand`/`ExternalEvent`** for triggering commands from modeless dialogs
- **ElementId comparison** — use `ElementId.InvalidElementId` not `null` for invalid checks
- **`using Autodesk.Revit.DB;`** covers most needs; add `Autodesk.Revit.UI;` for UI access

---

## IUpdater (DocumentUpdater / DMU)

For reacting to model changes automatically (Dynamic Model Updater):

```csharp
public class MyUpdater : IUpdater
{
    static AddInId _appId;
    static UpdaterId _updaterId;

    public MyUpdater(AddInId id)
    {
        _appId = id;
        _updaterId = new UpdaterId(_appId, new Guid("..."));
    }

    public void Execute(UpdaterData data)
    {
        // Runs when registered elements change
        foreach (ElementId id in data.GetModifiedElementIds())
        { /* ... */ }
    }

    public UpdaterId GetUpdaterId() => _updaterId;
    public ChangePriority GetChangePriority() => ChangePriority.MEPFixtures;
    public string GetUpdaterName() => "My Updater";
    public string GetAdditionalInformation() => "Watches wall changes";
}

// Register in OnStartup:
UpdaterRegistry.RegisterUpdater(new MyUpdater(app.ActiveAddInId));
ElementClassFilter wallFilter = new ElementClassFilter(typeof(Wall));
UpdaterRegistry.AddTrigger(updaterId, wallFilter, Element.GetChangeTypeAny());
```

---

## Reference Links
- Full API docs: https://www.revitapidocs.com/
- Version-specific: https://www.revitapidocs.com/{year}/ (e.g. /2025/, /2026/)
- What's new per version: https://www.revitapidocs.com/{year}/news