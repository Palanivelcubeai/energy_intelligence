import { createContext, useContext, useEffect, useState } from "react";
import { apiClient } from "@/services/apiClient";

interface PlantConfigContextType {
  plantName: string;
  setPlantName: (name: string) => void;
}

const PlantConfigContext = createContext<PlantConfigContextType>({
  plantName: "UNIT-01 PRECISION MFG",
  setPlantName: () => {},
});

export function PlantConfigProvider({ children }: { children: React.ReactNode }) {
  const [plantName, setPlantName] = useState("UNIT-01 PRECISION MFG");

  useEffect(() => {
    apiClient.get("/config").then(r => {
      if (r.data?.plantName) setPlantName(r.data.plantName);
    }).catch(() => {});
  }, []);

  return (
    <PlantConfigContext.Provider value={{ plantName, setPlantName }}>
      {children}
    </PlantConfigContext.Provider>
  );
}

export function usePlantConfig() {
  return useContext(PlantConfigContext);
}
