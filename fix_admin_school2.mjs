import fs from 'fs';
let code = fs.readFileSync('src/components/AdminSchoolManagement.tsx', 'utf8');

// Replace the first broken Sheet block
const brokenBlock = `<Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger render={
              <Button className="bg-slate-900 hover:bg-black text-white h-11 px-6 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all text-xs cursor-pointer">
                <Plus className="h-4 w-4" /> 
                Register School
              </Button>
            } />`;

code = code.replace(brokenBlock, '');

// Close the second Sheet correctly, check where the closing tag goes
// I will just use sed or string replace for `} />` to properly close SheetTrigger if needed
code = code.replace(`<SheetTrigger render={
                <></>
              } />
            } />`, ''); // I already did this so it might be fine now

// The second Sheet open is:
/*
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button className="bg-slate-900 hover:bg-black text-white h-11 px-6 rounded-xl font-bold flex items-center gap-2 shadow-sm transition-all text-xs cursor-pointer">
                  <Plus className="h-4 w-4" /> 
                  Register School
                </Button>
              </SheetTrigger>
            <SheetContent className="w-full sm:max-w-[540px] border-l-0 shadow-2xl p-0 flex flex-col h-full bg-white">
*/

fs.writeFileSync('src/components/AdminSchoolManagement.tsx', code);
console.log("Done");
