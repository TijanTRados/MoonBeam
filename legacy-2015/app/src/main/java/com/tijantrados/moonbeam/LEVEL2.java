package com.tijantrados.moonbeam;

import android.app.Activity;
import android.support.v7.app.ActionBarActivity;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;


public class LEVEL2 extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_level2);
    }


    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        // Inflate the menu; this adds items to the action bar if it is present.
        getMenuInflater().inflate(R.menu.menu_level2, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        // Handle action bar item clicks here. The action bar will
        // automatically handle clicks on the Home/Up button, so long
        // as you specify a parent activity in AndroidManifest.xml.
        int id = item.getItemId();

        //noinspection SimplifiableIfStatement
        if (id == R.id.action_settings) {
            return true;
        }

        return super.onOptionsItemSelected(item);
    }

    public boolean animationStart(){
         /*Zaključani = 0;
         Dok (prijemnici otključani i postoji živa loptica i odbrojavanje > 0) {
            Za svaku lopticu koja postoji {
                Loptica.pomakni();
                Za svaki prijemnik {
                    Ako (Postoji loptica čije su koordinate jednake koordinatama prijemnika i boja jednaka boji prijemnika) {
                        Prijemnik.zaključaj();
                        Zaključani++;
                    }
                    Ako (loptica van mreže) {
                        Loptica.uništi();
                    }
                }
                Osvježi ekran;
                Ako (Zaključani == broj prijemnika){
                    Razina je završena;
                }
            } */

        return true;
    }
}
