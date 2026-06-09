export async function analyzePhoto(
  image: string,
  instruction: string
){

  const res =
  await fetch(
    "http://localhost:8000/api/photo-analysis",
    {
     method:"POST",
     headers:{
      "Content-Type":"application/json"
     },
     body:JSON.stringify({
       image,
       instruction
     })
   }
  );


  if(!res.ok){
   throw new Error(
    "Photo analysis failed"
   );
  }


  return res.json();

}
